(function installReviewBrowserMock(target) {
  const storage = { local: {}, session: {} };
  const syntheticUrl = "http://127.0.0.1:4186/extension/synthetic.html";
  const screenshotCanvas = target.document.createElement("canvas"); screenshotCanvas.width = 640; screenshotCanvas.height = 400;
  const screenshotContext = screenshotCanvas.getContext("2d");
  function screenshotFrame(index) {
    const palettes = [["#f7f9f8", "#245f54"], ["#eef4f8", "#356b9a"], ["#fbf1e7", "#925222"], ["#f9ecea", "#a2463f"]];
    const [background, accent] = palettes[index % palettes.length];
    screenshotContext.fillStyle = background; screenshotContext.fillRect(0, 0, 640, 400); screenshotContext.fillStyle = accent; screenshotContext.fillRect(28, 28, 584, 54); screenshotContext.fillStyle = "#17221f"; screenshotContext.font = "24px sans-serif"; screenshotContext.fillText(`Synthetic resume frame ${index}`, 42, 140);
    return screenshotCanvas.toDataURL("image/png");
  }
  screenshotFrame(0);
  const metrics = { createdTabs: [], captures: 0, targetTabIds: [], mediaSourceIds: [], copiedText: "" };

  function area(name) {
    return {
      async get(keys) {
        const values = storage[name];
        if (keys == null) return { ...values };
        const requested = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(requested.map((key) => [key, values[key]]));
      },
      async set(values) { Object.assign(storage[name], values); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[name][key]; },
    };
  }

  target.chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: "0.6.10" }),
      getURL: (path) => `http://127.0.0.1:4186/extension/${path}`,
    },
    storage: { local: area("local"), session: area("session") },
    tabs: {
      async query() { return [{ id: 101, windowId: 7, url: syntheticUrl }]; },
      async create({ url }) { metrics.createdTabs.push(url); return { id: 102, windowId: 7, url }; },
      async captureVisibleTab() { metrics.captures += 1; return screenshotFrame(metrics.captures); },
    },
    tabCapture: {
      getMediaStreamId(options, callback) {
        metrics.targetTabIds.push(options?.targetTabId);
        target.document.documentElement.dataset.mockTargetTabId = String(options?.targetTabId ?? "");
        callback(`target-tab-stream-${options?.targetTabId}`);
      },
    },
  };
  target.fetch = async () => ({ ok: false, status: 503, async json() { return {}; } });
  target.confirm = () => true;
  Object.defineProperty(target.navigator, "clipboard", { configurable: true, value: { async writeText(value) { metrics.copiedText = value; } } });
  Object.defineProperty(target.navigator, "mediaDevices", { configurable: true, value: {
    async getUserMedia(constraints) {
      const mandatory = constraints?.video?.mandatory;
      if (mandatory?.chromeMediaSource !== "tab") throw new TypeError("Expected a Chrome tab media source");
      if (mandatory?.chromeMediaSourceId !== "target-tab-stream-101") throw new TypeError("Expected the selected BOSS tab stream");
      metrics.mediaSourceIds.push(mandatory.chromeMediaSourceId);
      target.document.documentElement.dataset.mockMediaSourceId = mandatory.chromeMediaSourceId;
      const stream = screenshotCanvas.captureStream(4);
      target.setTimeout(() => { screenshotContext.fillStyle = "#245f54"; screenshotContext.fillRect(28, 28, 584, 54); }, 0);
      return stream;
    },
  } });
  target.__reviewBrowserMetrics = metrics;
})(globalThis);
