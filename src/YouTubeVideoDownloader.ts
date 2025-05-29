import * as path from "node:path";
import { type WriteStream, createWriteStream } from 'node:fs';
import { Innertube, UniversalCache } from 'youtubei.js';
import GoogleVideo, { type Format } from 'googlevideo';
import generateWebPoToken from './generateWebPoToken';

type VideoInfo = Awaited<ReturnType<typeof Innertube.prototype.getBasicInfo>>

export default class YouTubeVideoDownloader {
    private serverAbrStream: GoogleVideo.ServerAbrStream | null = null;
    private info: VideoInfo | null = null;
    private title: string | undefined = undefined;
    private audioOutput: WriteStream | undefined = undefined;
    private audioFormat: Format | undefined = undefined;
    private videoOutput: WriteStream | undefined = undefined;
    private videoFormat: Format | undefined = undefined;

    constructor(private readonly videoId: string, private readonly progressCallbacks?: { audio?: (percentage: number) => void, video?: (percentage: number) => void }) { }

    async setup(): Promise<void> {
        const innertube = await Innertube.create({ cache: new UniversalCache(true) });
        const webPoTokenResult = await generateWebPoToken(innertube.session.context.client.visitorData || '');
        this.info = await innertube.getBasicInfo(this.videoId);

        const durationMs = (this.info.basic_info?.duration ?? 0) * 1000;

        const serverAbrStreamingUrl = innertube.session.player?.decipher(this.info.page[0].streaming_data?.server_abr_streaming_url);
        const videoPlaybackUstreamerConfig = this.info.page[0].player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config;

        if (!videoPlaybackUstreamerConfig)
            throw new Error('ustreamerConfig not found');

        if (!serverAbrStreamingUrl)
            throw new Error('serverAbrStreamingUrl not found');

        this.serverAbrStream = new GoogleVideo.ServerAbrStream({
            fetch: innertube.session.http.fetch_function,
            poToken: webPoTokenResult.poToken,
            serverAbrStreamingUrl,
            videoPlaybackUstreamerConfig: videoPlaybackUstreamerConfig,
            durationMs
        });

        this.title = this.info.basic_info.title?.replace(/[^a-z0-9A-Z_\-\(\)\[\]\~\<\>\s]/gi, '_');

        let downloadedBytesAudio = 0;
        let downloadedBytesVideo = 0;
        this.serverAbrStream.on('data', (streamData) => {
            for (const formatData of streamData.initializedFormats) {
                const isVideo = formatData.mimeType?.includes('video');
                const mediaFormat = this.info!.streaming_data?.adaptive_formats.find((f) => f.itag === formatData.formatId.itag);
                const mediaChunks = formatData.mediaChunks;

                if (isVideo && this.videoOutput && mediaChunks.length) {
                    for (const chunk of mediaChunks) {
                        downloadedBytesVideo += chunk.length;
                        this.videoOutput!.write(chunk);
                    }
                } else if (this.audioOutput && mediaChunks.length) {
                    for (const chunk of mediaChunks) {
                        downloadedBytesAudio += chunk.length;
                        this.audioOutput!.write(chunk);
                    }
                }

                const contentLength = mediaFormat?.content_length ?? 0;
                if (undefined === this.progressCallbacks || 0 == contentLength)
                    return;

                const downloadedBytes = isVideo ? downloadedBytesVideo : downloadedBytesAudio;
                const progressCallback = isVideo ? this.progressCallbacks.video : this.progressCallbacks.audio;

                if (undefined !== progressCallback)
                    progressCallback((downloadedBytes / contentLength) * 100);
            }
        });

        this.serverAbrStream.on('error', (error) => {
            console.error(error);
        });
    }

    prepareAudioDownload(downloadPath: string = '.'): string {
        const audioFormat = this.info!.chooseFormat({ quality: 'best', format: 'webm', type: 'audio' });

        this.audioFormat = {
            itag: audioFormat.itag,
            lastModified: audioFormat.last_modified_ms,
            xtags: audioFormat.xtags
        };

        const streamPath = path.join(downloadPath, `${this.title!}${this.videoFormat ? '_audio' : ''}.webm`);
        this.audioOutput = createWriteStream(streamPath);
        return streamPath;
    }

    prepareVideoDownload(downloadPath: string = '.'): string {
        const videoFormat = this.info!.chooseFormat({ quality: 'best', format: 'webm', type: 'video' });

        this.videoFormat = {
            itag: videoFormat.itag,
            lastModified: videoFormat.last_modified_ms,
            width: videoFormat.width,
            height: videoFormat.height,
            xtags: videoFormat.xtags
        };

        const streamPath = path.join(downloadPath, `${this.title!}${this.audioFormat ? '_video' : ''}.webm`);
        this.videoOutput = createWriteStream(streamPath);
        return streamPath;
    }

    async start(): Promise<void> {
        await this.serverAbrStream!.init({
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
