importScripts('./assets/vision/vision_bundle.js');
const { FilesetResolver, FaceLandmarker, ImageSegmenter } = self.vision;

let faceTracker;
let skinSegmenter;

async function initialize(delegate) {
  const base = new URL('./assets/vision/', self.location.href);
  const vision = await FilesetResolver.forVisionTasks(new URL('wasm/', base).href);
  try {
    faceTracker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: new URL('face_landmarker.task', base).href, delegate },
      runningMode: 'VIDEO', numFaces: 3,
      minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.55, outputFaceBlendshapes: true,
    });
    skinSegmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: new URL('selfie_multiclass.tflite', base).href, delegate },
      runningMode: 'VIDEO', outputCategoryMask: true, outputConfidenceMasks: false,
    });
    self.postMessage({ type: 'ready', delegate });
  } catch (error) {
    faceTracker?.close(); skinSegmenter?.close();
    faceTracker = null; skinSegmenter = null;
    if (delegate === 'GPU') await initialize('CPU');
    else throw error;
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'initialize') {
    try { await initialize('GPU'); }
    catch (error) { self.postMessage({ type: 'error', message: '视觉模型加载失败，请重试。' }); }
    return;
  }
  if (data.type !== 'frame') return;
  const { bitmap, timestamp, segment } = data;
  if (!faceTracker || !skinSegmenter) { bitmap.close(); return; }
  try {
    const started = performance.now();
    const face = faceTracker.detectForVideo(bitmap, timestamp);
    let skin;
    if (segment && face.faceLandmarks.length) {
      skinSegmenter.segmentForVideo(bitmap, timestamp, result => {
        const mask = result.categoryMask;
        skin = { width: mask.width, height: mask.height, data: mask.getAsUint8Array().slice() };
      });
    }
    const transfer = [bitmap];
    if (skin) transfer.push(skin.data.buffer);
    const faces=face.faceLandmarks.map((landmarks,index)=>({
      landmarks,expressions:face.faceBlendshapes[index]?.categories||[],
    }));
    self.postMessage({ type: 'frame', bitmap, faces, skin,
      inferenceMs: performance.now() - started, timestamp }, transfer);
  } catch (error) {
    bitmap.close();
    self.postMessage({ type: 'frame-error', message: '实时追踪中断，请重试。' });
  }
};
