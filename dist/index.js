// src/YouTubeVideoDownloader.ts
import * as path from "node:path";
import { createWriteStream } from "node:fs";
import { Innertube, UniversalCache } from "youtubei.js";
import GoogleVideo from "googlevideo";

// src/generateWebPoToken.ts
import { BG } from "bgutils-js";
import { JSDOM } from "jsdom";
async function generateWebPoToken(visitorData) {
  const requestKey = "O43z0dpjhgX20SCx4KAo";
  if (!visitorData)
    throw new Error("Could not get visitor data");
  const dom = new JSDOM;
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
  const bgChallenge = await BG.Challenge.create(bgConfig);
  if (!bgChallenge)
    throw new Error("Could not get challenge");
  const interpreterJavascript = bgChallenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (interpreterJavascript) {
    new Function(interpreterJavascript)();
  } else
    throw new Error("Could not load VM");
  const poTokenResult = await BG.PoToken.generate({
    program: bgChallenge.program,
    globalName: bgChallenge.globalName,
    bgConfig
  });
  const placeholderPoToken = BG.PoToken.generatePlaceholder(visitorData);
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
    const innertube = await Innertube.create({ cache: new UniversalCache(true) });
    const webPoTokenResult = await generateWebPoToken(innertube.session.context.client.visitorData || "");
    this.info = await innertube.getBasicInfo(this.videoId);
    const durationMs = (this.info.basic_info?.duration ?? 0) * 1000;
    const serverAbrStreamingUrl = innertube.session.player?.decipher(this.info.page[0].streaming_data?.server_abr_streaming_url);
    const videoPlaybackUstreamerConfig = this.info.page[0].player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config;
    if (!videoPlaybackUstreamerConfig)
      throw new Error("ustreamerConfig not found");
    if (!serverAbrStreamingUrl)
      throw new Error("serverAbrStreamingUrl not found");
    this.serverAbrStream = new GoogleVideo.ServerAbrStream({
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
    this.audioOutput = createWriteStream(streamPath);
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
    this.videoOutput = createWriteStream(streamPath);
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
export {
  src_default as default
};
