import AVFoundation
import Foundation

struct KeepRange: Codable {
    let start: Double
    let end: Double
}

struct RenderRequest: Codable {
    let keepRanges: [KeepRange]
    let videoOffset: Double?
}

guard CommandLine.arguments.count == 5 else {
    fputs("Usage: swift render.swift SOURCE_VIDEO NORMALIZED_AUDIO EDL_JSON OUTPUT_MP4\n", stderr)
    exit(2)
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let audioURL = URL(fileURLWithPath: CommandLine.arguments[2])
let edlURL = URL(fileURLWithPath: CommandLine.arguments[3])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[4])
let request = try JSONDecoder().decode(RenderRequest.self, from: Data(contentsOf: edlURL))
let asset = AVURLAsset(url: sourceURL)
let audioAsset = AVURLAsset(url: audioURL)

guard let sourceVideo = asset.tracks(withMediaType: .video).first,
      let originalAudio = asset.tracks(withMediaType: .audio).first,
      let sourceAudio = audioAsset.tracks(withMediaType: .audio).first else {
    fputs("Source must contain video and audio tracks.\n", stderr)
    exit(3)
}

func firstMediaTargetStart(_ track: AVAssetTrack) -> Double {
    guard let segment = track.segments.first(where: { !$0.isEmpty }) else { return 0 }
    return CMTimeGetSeconds(segment.timeMapping.target.start)
}

let measuredOffset = max(0, firstMediaTargetStart(originalAudio) - firstMediaTargetStart(sourceVideo))
let timelineOffset = request.videoOffset ?? measuredOffset
let composition = AVMutableComposition()
guard let compositionVideo = composition.addMutableTrack(
        withMediaType: .video,
        preferredTrackID: kCMPersistentTrackID_Invalid
      ),
      let compositionAudio = composition.addMutableTrack(
        withMediaType: .audio,
        preferredTrackID: kCMPersistentTrackID_Invalid
      ) else {
    fputs("Could not create output tracks.\n", stderr)
    exit(4)
}
compositionVideo.preferredTransform = sourceVideo.preferredTransform

var cursor = CMTime.zero
for item in request.keepRanges {
    guard item.end > item.start else { continue }
    let videoStart = item.start + timelineOffset
    let audioStart = item.start
    let requestedDuration = item.end - item.start
    let videoAvailable = CMTimeGetSeconds(CMTimeRangeGetEnd(sourceVideo.timeRange)) - videoStart
    let audioAvailable = CMTimeGetSeconds(CMTimeRangeGetEnd(sourceAudio.timeRange)) - audioStart
    let duration = min(requestedDuration, videoAvailable, audioAvailable)
    guard duration > 0.001 else { continue }
    let videoRange = CMTimeRange(
        start: CMTime(seconds: videoStart, preferredTimescale: 60000),
        duration: CMTime(seconds: duration, preferredTimescale: 60000)
    )
    let audioRange = CMTimeRange(
        start: CMTime(seconds: audioStart, preferredTimescale: 60000),
        duration: CMTime(seconds: duration, preferredTimescale: 60000)
    )
    try compositionVideo.insertTimeRange(videoRange, of: sourceVideo, at: cursor)
    try compositionAudio.insertTimeRange(audioRange, of: sourceAudio, at: cursor)
    cursor = CMTimeAdd(cursor, videoRange.duration)
}

try? FileManager.default.removeItem(at: outputURL)
guard let exporter = AVAssetExportSession(
    asset: composition,
    presetName: AVAssetExportPresetHighestQuality
) else {
    fputs("Could not create video exporter.\n", stderr)
    exit(5)
}
exporter.outputURL = outputURL
exporter.outputFileType = .mp4
exporter.shouldOptimizeForNetworkUse = true

let semaphore = DispatchSemaphore(value: 0)
exporter.exportAsynchronously { semaphore.signal() }
semaphore.wait()

guard exporter.status == .completed else {
    fputs("Export failed: \(exporter.error?.localizedDescription ?? "unknown error")\n", stderr)
    exit(6)
}

print("{\"duration\":\(CMTimeGetSeconds(composition.duration)),\"videoOffset\":\(timelineOffset)}")
