import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamChat } from './sse';

describe('streamChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves named events when event and data arrive in separate chunks', async () => {
    const chunks = [
      'event: tool_call_start\n',
      'data: {"tool":"file_write","arguments":"{}"}\n\n',
      'event: tool_call_end\n',
      'data: {"tool":"file_write","success":true,"latency":4}\n\n',
      'data: [DONE]\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 })),
    );

    const events = [];
    for await (const event of streamChat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Create a note' }],
      stream: true,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        event: 'tool_call_start',
        data: '{"tool":"file_write","arguments":"{}"}',
      },
      {
        event: 'tool_call_end',
        data: '{"tool":"file_write","success":true,"latency":4}',
      },
    ]);
  });
});
