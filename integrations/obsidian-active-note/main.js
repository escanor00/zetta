const { Plugin, requestUrl } = require("obsidian");

const SERVER_URL = "http://127.0.0.1:8000/v1/obsidian/active-note";
const HEARTBEAT_MS = 15000;
const OBSIDIAN_FILE_EXTENSIONS = new Set(["md", "markdown", "txt", "canvas"]);

module.exports = class OpenJarvisActiveNotePlugin extends Plugin {
  async onload() {
    this.statusBar = this.addStatusBarItem();
    this.statusBar.setText("OpenJarvis: conectando…");
    this.updateQueue = Promise.resolve();

    const queueUpdate = () => this.queueActiveNoteUpdate();
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", queueUpdate),
    );
    this.registerEvent(this.app.workspace.on("file-open", queueUpdate));
    this.registerInterval(
      window.setInterval(queueUpdate, HEARTBEAT_MS),
    );
    this.app.workspace.onLayoutReady(queueUpdate);
  }

  queueActiveNoteUpdate() {
    const file = this.app.workspace.getActiveFile();
    const extension = file?.extension?.toLowerCase();
    const update = {
      vault: this.app.vault.getName(),
      path: file && OBSIDIAN_FILE_EXTENSIONS.has(extension) ? file.path : null,
    };

    this.updateQueue = this.updateQueue
      .catch(() => undefined)
      .then(() => this.sendActiveNote(update));
  }

  async sendActiveNote(update) {
    try {
      const response = await requestUrl({
        url: SERVER_URL,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(update),
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`OpenJarvis returned HTTP ${response.status}`);
      }
      this.statusBar.setText(
        update.path
          ? "OpenJarvis: arquivo vinculado"
          : "OpenJarvis: sem arquivo ativo",
      );
    } catch {
      this.statusBar.setText("OpenJarvis: servidor indisponível");
    }
  }
};
