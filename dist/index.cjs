var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __moduleCache = /* @__PURE__ */ new WeakMap;
var __toCommonJS = (from) => {
  var entry = __moduleCache.get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function")
    __getOwnPropNames(from).map((key) => !__hasOwnProp.call(entry, key) && __defProp(entry, key, {
      get: () => from[key],
      enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    }));
  __moduleCache.set(from, entry);
  return entry;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};

// src/index.ts
var exports_src = {};
__export(exports_src, {
  default: () => src_default
});
module.exports = __toCommonJS(exports_src);

// src/YouTubeVideoDownloader.ts
var path = __toESM(require("node:path"));
var import_node_fs = require("node:fs");
var import_youtubei = require("youtubei.js");
var import_googlevideo = __toESM(require("googlevideo"));

// src/generateWebPoToken.ts
var import_bgutils_js = require("bgutils-js");
var import_jsdom = require("jsdom");
async function generateWebPoToken(visitorData) {
  const requestKey = "O43z0dpjhgX20SCx4KAo";
  if (!visitorData)
    throw new Error("Could not get visitor data");
  const dom = new import_jsdom.JSDOM;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document
  });
  const bgConfig = {
    fetch,
    globalObj: globalThis,
    identifier: visitorData,
    requestKey
  };
  const bgChallenge = await import_bgutils_js.BG.Challenge.create(bgConfig);
  if (!bgChallenge)
    throw new Error("Could not get challenge");
  const interpreterJavascript = bgChallenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (interpreterJavascript) {
    new Function(interpreterJavascript)();
  } else
    throw new Error("Could not load VM");
  const poTokenResult = await import_bgutils_js.BG.PoToken.generate({
    program: bgChallenge.program,
    globalName: bgChallenge.globalName,
    bgConfig
  });
  const placeholderPoToken = import_bgutils_js.BG.PoToken.generatePlaceholder(visitorData);
  return {
    visitorData,
    placeholderPoToken,
    poToken: poTokenResult.poToken
  };
}

// src/YouTubeVideoDownloader.ts
class YouTubeVideoDownloader {
  videoId;
  progressCallbacks;
  serverAbrStream = null;
  info = null;
  title = undefined;
  audioOutput = undefined;
  audioFormat = undefined;
  videoOutput = undefined;
  videoFormat = undefined;
  constructor(videoId, progressCallbacks) {
    this.videoId = videoId;
    this.progressCallbacks = progressCallbacks;
  }
  async setup() {
    const innertube = await import_youtubei.Innertube.create({ cache: new import_youtubei.UniversalCache(true) });
    const webPoTokenResult = await generateWebPoToken(innertube.session.context.client.visitorData || "");
    this.info = await innertube.getBasicInfo(this.videoId);
    const durationMs = (this.info.basic_info?.duration ?? 0) * 1000;
    const serverAbrStreamingUrl = innertube.session.player?.decipher(this.info.page[0].streaming_data?.server_abr_streaming_url);
    const videoPlaybackUstreamerConfig = this.info.page[0].player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config;
    if (!videoPlaybackUstreamerConfig)
      throw new Error("ustreamerConfig not found");
    if (!serverAbrStreamingUrl)
      throw new Error("serverAbrStreamingUrl not found");
    this.serverAbrStream = new import_googlevideo.default.ServerAbrStream({
      fetch: innertube.session.http.fetch_function,
      poToken: webPoTokenResult.poToken,
      serverAbrStreamingUrl,
      videoPlaybackUstreamerConfig,
      durationMs
    });
    this.title = this.info.basic_info.title?.replace(/[^a-z0-9A-Z_\-\(\)\[\]\~\<\>\s]/gi, "_");
    let downloadedBytesAudio = 0;
    let downloadedBytesVideo = 0;
    this.serverAbrStream.on("data", (streamData) => {
      for (const formatData of streamData.initializedFormats) {
        const isVideo = formatData.mimeType?.includes("video");
        const mediaFormat = this.info.streaming_data?.adaptive_formats.find((f) => f.itag === formatData.formatId.itag);
        const mediaChunks = formatData.mediaChunks;
        if (isVideo && this.videoOutput && mediaChunks.length) {
          for (const chunk of mediaChunks) {
            downloadedBytesVideo += chunk.length;
            this.videoOutput.write(chunk);
          }
        } else if (this.audioOutput && mediaChunks.length) {
          for (const chunk of mediaChunks) {
            downloadedBytesAudio += chunk.length;
            this.audioOutput.write(chunk);
          }
        }
        const contentLength = mediaFormat?.content_length ?? 0;
        if (this.progressCallbacks === undefined || contentLength == 0)
          return;
        const downloadedBytes = isVideo ? downloadedBytesVideo : downloadedBytesAudio;
        const progressCallback = isVideo ? this.progressCallbacks.video : this.progressCallbacks.audio;
        if (progressCallback !== undefined)
          progressCallback(downloadedBytes / contentLength * 100);
      }
    });
    this.serverAbrStream.on("error", (error) => {
      console.error(error);
    });
  }
  prepareAudioDownload(downloadPath = ".") {
    const audioFormat = this.info.chooseFormat({ quality: "best", format: "webm", type: "audio" });
    this.audioFormat = {
      itag: audioFormat.itag,
      lastModified: audioFormat.last_modified_ms,
      xtags: audioFormat.xtags
    };
    const streamPath = path.join(downloadPath, `${this.title}${this.videoFormat ? "_audio" : ""}.webm`);
    this.audioOutput = import_node_fs.createWriteStream(streamPath);
    return streamPath;
  }
  prepareVideoDownload(downloadPath = ".") {
    const videoFormat = this.info.chooseFormat({ quality: "best", format: "webm", type: "video" });
    this.videoFormat = {
      itag: videoFormat.itag,
      lastModified: videoFormat.last_modified_ms,
      width: videoFormat.width,
      height: videoFormat.height,
      xtags: videoFormat.xtags
    };
    const streamPath = path.join(downloadPath, `${this.title}${this.audioFormat ? "_video" : ""}.webm`);
    this.videoOutput = import_node_fs.createWriteStream(streamPath);
    return streamPath;
  }
  async start() {
    await this.serverAbrStream.init({
      audioFormats: this.audioFormat ? [this.audioFormat] : [],
      videoFormats: this.videoFormat ? [this.videoFormat] : [],
      clientAbrState: {
        playerTimeMs: 0,
        enabledTrackTypesBitfield: this.videoFormat ? 0 : 1
      }
    });
    this.audioOutput?.end();
    this.videoOutput?.end();
  }
}

// src/index.ts
var src_default = YouTubeVideoDownloader;
