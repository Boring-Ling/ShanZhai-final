// The selector and the live effect share the same approved character artwork.
// Points below are measured on the source PNGs in normalized image coordinates.
export const CHARACTER_FACES = {
  chiikawa: { leftEye: [.35, .40], rightEye: [.61, .45], crown: .17, chin: .89, width: .83, headCenter: .48 },
  hachiware: { leftEye: [.34, .55], rightEye: [.58, .55], crown: .28, chin: .83, width: .77, headCenter: .49 },
  usagi: { leftEye: [.36, .65], rightEye: [.54, .64], crown: .34, chin: .90, width: .63, headCenter: .48 },
  lulu: { leftEye: [.407, .425], rightEye: [.637, .382], crown: .27, chin: .83, width: .70,
    artCenter: .51, firstPaint: [[.345, .505], [.70, .58]] },
};

const SIZE = 256;
export const FIRST_PAINT_PROGRESS = .025;
const FACE_OUTLINE = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function fitLulu(alpha, face, localX, localY, cheekCenter, targetChin, design, baseSize) {
  const outline = FACE_OUTLINE.map(index => [localX(face[index]), targetChin - localY(face[index])]);
  let bestSize = baseSize, fewestMisses = Infinity;
  for (let step = 0; step <= 22; step++) {
    const size = baseSize * (1 + step * .025);
    let misses = 0;
    for (const [across, fromChin] of outline) {
      const u = Math.floor((design.artCenter - (across - cheekCenter) / size) * SIZE);
      const v = Math.floor((design.chin - fromChin / size) * SIZE);
      if (u < 0 || u >= SIZE || v < 0 || v >= SIZE || alpha[(v * SIZE + u) * 4 + 3] < 240) misses++;
    }
    if (misses === 0) return size;
    if (misses < fewestMisses) {
      bestSize = size;
      fewestMisses = misses;
    }
  }
  return bestSize;
}

function fitHead(skin, picture, pose, design, size, forehead, chin) {
  const { width, height } = picture;
  const { x, y, cosine, sine, faceWidth } = pose;
  const ovalHeight = design.chin - design.crown;
  let required = Math.max(size * 1.08, (chin - forehead + faceWidth * .24) / ovalHeight);
  if (skin) {
    const radius = faceWidth * 1.35;
    const left = Math.max(0, Math.floor((x - radius) * skin.width / width));
    const right = Math.min(skin.width, Math.ceil((x + radius) * skin.width / width));
    const top = Math.max(0, Math.floor((y - radius) * skin.height / height));
    const bottom = Math.min(skin.height, Math.ceil((y + radius) * skin.height / height));
    for (let row = top; row < bottom; row += 2) {
      for (let col = left; col < right; col += 2) {
        if (skin.data[row * skin.width + col] !== 1) continue; // MediaPipe hair.
        const dx = (col + .5) * width / skin.width - x;
        const dy = (row + .5) * height / skin.height - y;
        const u = dx * cosine + dy * sine;
        const v = -dx * sine + dy * cosine;
        if (Math.abs(u) > faceWidth * .79 || v > forehead + faceWidth * .24 || v < forehead - faceWidth * .84) continue;
        // Find the smallest scale that encloses this sample inside the main
        // head oval while keeping its bottom at the viewer's chin.
        const depth = chin - v + faceWidth * .035;
        if (depth <= 0) continue;
        const across = (Math.abs(u) + faceWidth * .035) / (design.width * .45);
        required = Math.max(required, depth / ovalHeight + ovalHeight * across * across / (4 * depth));
      }
    }
  }
  return Math.min(required, size * 1.48);
}

function buildArrivalMap(design) {
  const map = new Float32Array(SIZE * SIZE);
  const height = design.chin - design.crown;
  const center = (design.leftEye[0] + design.rightEye[0]) / 2;
  const firstPaint = design.firstPaint ?? [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const x = (col + 0.5) / SIZE;
      const y = (row + 0.5) / SIZE;
      const u = (x - center) / design.width;
      const v = (y - design.crown) / height;
      // Several paint patches spread across the cheeks and forehead. The
      // perimeter fills later, so the real face stays legible at the start.
      const distance = Math.min(
        Math.hypot(u + .27, (v - .54) * .83),
        Math.hypot(u - .27, (v - .55) * .83) + .03,
        Math.hypot(u + .05, (v - .19) * .83) + .10,
      );
      const rim = Math.hypot(u * 2, (v - .52) * 2);
      const texture = .022 * Math.sin(x * 58 + y * 21) * Math.cos(y * 61 - x * 32);
      let arrival = .12 + .79 * distance + .22 * rim * rim + texture;
      for (const [seedX, seedY] of firstPaint) {
        const spread = .027 + .88 * Math.hypot((x - seedX) * 1.3, (y - seedY) * 1.5);
        arrival = Math.min(arrival, spread + texture * .2);
      }
      // Reserve the real eyes until the paint around them has spread.
      const eyeDistance = Math.min(
        Math.hypot((x - design.leftEye[0]) / .103, (y - design.leftEye[1]) / .070),
        Math.hypot((x - design.rightEye[0]) / .103, (y - design.rightEye[1]) / .070),
      );
      if (eyeDistance < 1) arrival = Math.max(arrival, .65 - .07 * eyeDistance);
      // Above the crown the original ears appear late, growing from their roots.
      if (v < .15) {
        const earArrival = .78 + clamp(.09 - v, 0, .54) * .29 + texture * .6 + .018 * Math.cos(x * 26);
        const blend = clamp((.15 - v) / .10, 0, 1);
        arrival += (earArrival - arrival) * blend;
      }
      map[row * SIZE + col] = clamp(arrival, design.firstPaint ? FIRST_PAINT_PROGRESS : .09, .965);
    }
  }
  return map;
}

export class CharacterFaces {
  constructor() {
    this.images = new Map();
    this.mask = document.createElement('canvas');
    this.frame = document.createElement('canvas');
    this.mask.width = this.mask.height = this.frame.width = this.frame.height = SIZE;
    this.maskContext = this.mask.getContext('2d');
    this.frameContext = this.frame.getContext('2d');
    this.pixels = this.maskContext.createImageData(SIZE, SIZE);
    this.renderKey = '';
  }

  prepare(group, progress) {
    const design = CHARACTER_FACES[group];
    let source = this.images.get(group);
    if (!source) {
      const image = new Image();
      image.src = new URL(`./assets/pool-${group}.png`, import.meta.url).href;
      source = { image, map: buildArrivalMap(design) };
      this.images.set(group, source);
    }
    if (progress < (design.firstPaint ? FIRST_PAINT_PROGRESS : .085) || !source.image.complete || !source.image.naturalWidth) return null;
    if (design.firstPaint && !source.alpha) {
      const ctx = this.frameContext;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(source.image, 0, 0, SIZE, SIZE);
      source.alpha = ctx.getImageData(0, 0, SIZE, SIZE).data;
      this.renderKey = '';
    }
    if (progress >= .99) return source.image;

    // One masked texture per progress value, reused for all tracked people.
    const step = Math.round(progress * 120);
    const key = group + ':' + step;
    if (this.renderKey !== key) {
      const data = this.pixels.data;
      for (let i = 0; i < source.map.length; i++) {
        data[i * 4 + 3] = 255 * clamp((step / 120 - source.map[i]) * 55 + .5, 0, 1);
      }
      this.maskContext.putImageData(this.pixels, 0, 0);
      const ctx = this.frameContext;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(source.image, 0, 0, SIZE, SIZE);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(this.mask, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      this.renderKey = key;
    }
    return this.frame;
  }

  draw(ctx, image, face, design, width, height, progress, skin) {
    const eye = (a, b) => ({ x: (face[a].x + face[b].x) * width / 2, y: (face[a].y + face[b].y) * height / 2 });
    const left = eye(33, 133), right = eye(362, 263);
    const centerX = (left.x + right.x) / 2;
    const centerY = (left.y + right.y) / 2;
    const angle = Math.atan2(right.y - left.y, right.x - left.x);
    const faceWidth = Math.hypot((face[454].x - face[234].x) * width, (face[454].y - face[234].y) * height);
    if (faceWidth < 2) return;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const localX = landmark => (landmark.x * width - centerX) * cosine + (landmark.y * height - centerY) * sine;
    const localY = landmark => -(landmark.x * width - centerX) * sine + (landmark.y * height - centerY) * cosine;
    const chin = localY(face[152]);
    const sourceX = (design.leftEye[0] + design.rightEye[0]) / 2;
    const sourceY = (design.leftEye[1] + design.rightEye[1]) / 2;
    const baseSize = faceWidth * 1.24 / design.width;
    const targetChin = chin + faceWidth * (design.firstPaint ? .055 : .015);
    // Early paint follows the real eyes. Settle the nearly complete character
    // onto the jaw by translating the artwork at its original proportions.
    const settle = clamp((progress - .48) / .35, 0, 1);
    const smooth = settle * settle * (3 - 2 * settle);
    let size = baseSize;
    let anchorX = sourceX;
    let offsetX = 0;
    if (design.headCenter && smooth > 0) {
      const pose = { x: centerX, y: centerY, cosine, sine, faceWidth };
      size += (fitHead(skin, { width, height }, pose, design, baseSize, localY(face[10]), targetChin) - size) * smooth;
      anchorX += (design.headCenter - sourceX) * smooth;
    }
    const luluAlpha = design.firstPaint ? this.images.get('lulu')?.alpha : null;
    if (luluAlpha && smooth > 0) {
      const cheekCenter = (localX(face[234]) + localX(face[454])) / 2;
      size += (fitLulu(luluAlpha, face, localX, localY, cheekCenter, targetChin, design, baseSize) - size) * smooth;
      anchorX += (design.artCenter - sourceX) * smooth;
      offsetX = cheekCenter * smooth;
    }
    const jawAdjustment = targetChin - (design.chin - sourceY) * size;
    const y = -sourceY * size + jawAdjustment * smooth;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(angle);
    ctx.translate(offsetX, 0);
    // The webcam layer is mirrored in CSS. Preserve the original art's asymmetry.
    ctx.scale(-1, 1);
    ctx.drawImage(image, -anchorX * size, y, size, size);
    ctx.restore();
  }
}
