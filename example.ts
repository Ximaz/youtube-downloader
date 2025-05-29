import YouTubeVideoDownloader from "youtube-downloader";

const main = async () => {
    const downloader = new YouTubeVideoDownloader("<VIDEO_ID>",
        (percentage) => console.log(`audio download: ${percentage}%`),
        (percentage) => console.log(`video download: ${percentage}%`),
    )

    await downloader.setup()
    downloader.prepareAudioDownload('.');
    downloader.prepareVideoDownload('.');

    await downloader.start();
}

await main()