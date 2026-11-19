import { DyeEffect } from './dye-effect.js?v=pool-face-sync-1';

const $ = (id) => document.getElementById(id);
const camera = $('camera');
const pools = {
  nailong: { name: '奶龙 / 奶蛙', handle: '奶龙放映室', tag: '#奶龙 #奶蛙 #今天也要开心', avatar: 'nailong.png', clips: ['nailong-01', 'nailong-02', 'nailong-03', 'nailong-04'] },
  lulu: { name: '噜噜', handle: '噜噜循环播放', tag: '#噜噜 #再看一遍 #为你推荐', avatar: 'lulu.png', clips: ['lulu-01', 'lulu-02', 'lulu-03', 'lulu-04'] },
  jokebear: { name: 'Joke Bear', handle: 'Joke Bear 日常', tag: '#JokeBear #熊的日常 #循环', avatar: 'jokebear.png', clips: ['jokebear-01', 'jokebear-02', 'jokebear-03', 'jokebear-04'] },
  chiikawa: {
    name: '吉伊',
    handle: '吉伊放映室',
    tag: '#吉伊 #Chiikawa',
    avatar: 'pool-chiikawa.png',
    clips: Array.from({ length: 14 }, (_, index) => 'chiikawa-' + String(index + 1).padStart(2, '0')),
  },
  usagi: {
    name: '乌萨奇',
    handle: '乌萨奇放映室',
    tag: '#乌萨奇 #Usagi',
    avatar: 'pool-usagi.png',
    clips: Array.from({ length: 9 }, (_, index) => 'usagi-' + String(index + 1).padStart(2, '0')),
  },
  hachiware: {
    name: '小八',
    handle: '小八放映室',
    tag: '#小八 #Hachiware',
    avatar: 'pool-hachiware.png',
    clips: Array.from({ length: 12 }, (_, index) => 'hachiware-' + String(index + 1).padStart(2, '0')),
  },
};
let group = 'nailong';
let index = 0;
let swipes = 0;
let stream = null;
let cameraPending = false;
let cameraGeneration = 0;
let muted = true;
let transitioning = false;
let transitionGeneration = 0;
let currentCard;
let touchStart = null;
let toastTimer;
const interactions = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const dye = new DyeEffect(camera, $('dye-canvas'), $('features-canvas'), (message, failed) => {
  if ($('tracking-status').textContent !== message) $('tracking-status').textContent = message;
  $('retry-effect').hidden = !failed;
});
function updateProgress() {
  dye.setProgress(swipes);
  const effect = dye.label;
  $('effect-progress').textContent = effect ? effect + ' ' + Math.round(dye.target * 100) + '%' : '实时原画面';
}
const icon = (name, cls = '') => '<svg class="' + cls + '" aria-hidden="true"><use href="#' + name + '-icon"/></svg>';
function notify(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2500);
}
function clipId() {
  const clips = pools[group].clips;
  return clips[((index % clips.length) + clips.length) % clips.length];
}
function stats(id = clipId()) {
  if (!interactions.has(id)) interactions.set(id, { liked: false, saved: false, followed: false, comments: [] });
  return interactions.get(id);
}
function makeCard() {
  const pool = pools[group];
  const id = clipId();
  const state = stats(id);
  const article = document.createElement('article');
  article.className = 'feed-card';
  article.dataset.clip = id;
  article.innerHTML = '<video playsinline loop preload="metadata" aria-label="' + pool.name + '短视频" src="assets/' + id + '.mp4"></video><span class="paused-symbol" hidden>▶</span>' +
    '<div class="feed-copy"><strong>@' + pool.handle + '</strong><p>' + pool.tag + '</p><small>♫ 原声 · ' + pool.handle + '</small></div>' +
    '<div class="feed-actions"><button class="avatar-button" data-action="follow" aria-label="关注作者" aria-pressed="' + state.followed + '"><img class="avatar" src="assets/' + pool.avatar + '" alt=""><span>' + (state.followed ? '✓' : '+') + '</span></button>' +
    '<button data-action="like" aria-label="点赞" aria-pressed="' + state.liked + '">' + icon('heart') + '<span>' + (1024 + Number(state.liked)) + '</span></button>' +
    '<button data-action="comment" aria-label="打开评论">' + icon('comment', 'comment-svg') + '<span>' + state.comments.length + '</span></button>' +
    '<button class="save" data-action="save" aria-label="收藏" aria-pressed="' + state.saved + '">' + icon('star') + '<span>' + (81 + Number(state.saved)) + '</span></button>' +
    '<button data-action="share" aria-label="分享">' + icon('share') + '<span>分享</span></button></div>';
  const video = article.querySelector('video');
  video.muted = muted;
  video.addEventListener('error', () => { if (article === currentCard) $('retry-video').hidden = false; });
  article.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) {
      if (video.paused) playCard(article);
      else { video.pause(); article.querySelector('.paused-symbol').hidden = false; }
      return;
    }
    const action = button.dataset.action;
    if (action === 'like') { state.liked = !state.liked; button.setAttribute('aria-pressed', state.liked); button.querySelector('span').textContent = 1024 + Number(state.liked); }
    if (action === 'save') { state.saved = !state.saved; button.setAttribute('aria-pressed', state.saved); button.querySelector('span').textContent = 81 + Number(state.saved); }
    if (action === 'follow') { state.followed = !state.followed; button.setAttribute('aria-pressed', state.followed); button.querySelector('span').textContent = state.followed ? '✓' : '+'; }
    if (action === 'comment') openComments();
    if (action === 'share') navigator.clipboard.writeText(location.href).then(() => notify('链接已复制')).catch(() => notify('请复制浏览器地址栏中的链接'));
  });
  return article;
}
async function playCard(card) {
  const video = card.querySelector('video');
  try { await video.play(); card.querySelector('.paused-symbol').hidden = true; }
  catch (error) {
    if (error.name === 'AbortError' || card !== currentCard) return;
    if (error.name === 'NotAllowedError' && !video.muted) {
      muted = true; video.muted = true; updateSound();
      try { await video.play(); return; } catch { /* Display the playback action below. */ }
    }
    card.querySelector('.paused-symbol').hidden = false;
  }
}
function renderInitialCard() {
  transitionGeneration++;
  transitioning = false;
  $('retry-video').hidden = true;
  $('feed-stage').querySelectorAll('video').forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); });
  currentCard = makeCard();
  $('feed-stage').replaceChildren(currentCard);
  playCard(currentCard);
}
async function changeVideo(direction = 1) {
  if (transitioning || !$('comments').hidden) return;
  transitioning = true;
  const generation = ++transitionGeneration;
  const outgoing = currentCard;
  index += direction;
  swipes++;
  updateProgress();
  const incoming = makeCard();
  currentCard = incoming;
  $('retry-video').hidden = true;
  $('feed-stage').append(incoming);
  $('feed-stage').dispatchEvent(new Event('feed-swipe', { bubbles: true }));
  outgoing.querySelector('video').pause();
  playCard(incoming);
  const duration = reducedMotion.matches ? 0 : 360;
  const options = { duration, easing: 'cubic-bezier(.22,.7,.2,1)', fill: 'both' };
  const enter = incoming.animate([{ transform: 'translateY(' + (direction * 100) + '%)' }, { transform: 'translateY(0)' }], options);
  const exit = outgoing.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(' + (-direction * 100) + '%)' }], options);
  await Promise.allSettled([enter.finished, exit.finished]);
  if (generation !== transitionGeneration) return;
  outgoing.querySelector('video').removeAttribute('src');
  outgoing.querySelector('video').load();
  outgoing.remove();
  enter.cancel();
  transitioning = false;
}
function updateSound() {
  $('sound').setAttribute('aria-label', muted ? '开启视频声音' : '关闭视频声音');
  $('sound').title = muted ? '开启视频声音' : '关闭视频声音';
  $('sound').querySelector('.mute-mark').hidden = !muted;
}
$('sound').addEventListener('click', () => { muted = !muted; updateSound(); currentCard.querySelector('video').muted = muted; playCard(currentCard); });
$('next').addEventListener('click', () => changeVideo());
let lastWheel = -Infinity;
window.addEventListener('wheel', (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || !$('comments').hidden) return;
  const { deltaMode, deltaX, deltaY } = event;
  if (!deltaY || Math.abs(deltaX) > Math.abs(deltaY)) return;
  event.preventDefault();
  const now = performance.now();
  if (transitioning || now - lastWheel < 550 ||
      (deltaMode === WheelEvent.DOM_DELTA_PIXEL && Math.abs(deltaY) < 8)) return;
  lastWheel = now;
  changeVideo(Math.sign(deltaY));
}, { passive: false });
window.addEventListener('keydown', (event) => {
  if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  if (event.key === 'Escape') $('comments').hidden = true;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); changeVideo(event.key === 'ArrowDown' ? 1 : -1); }
});
$('phone-frame').addEventListener('pointerdown', event => { if (!event.target.closest('button,input,.comments')) touchStart = event.clientY; });
$('phone-frame').addEventListener('pointerup', event => { if (touchStart !== null && Math.abs(event.clientY - touchStart) > 45) changeVideo(event.clientY < touchStart ? 1 : -1); touchStart = null; });
$('phone-frame').addEventListener('pointercancel', () => { touchStart = null; });
$('pool').addEventListener('click', event => {
  const button = event.target.closest('button[data-pool]');
  if (!button || button.dataset.pool === group) return;
  $('pool').querySelector('[aria-pressed="true"]').setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-pressed', 'true');
  group = button.dataset.pool;
  index = 0;
  swipes = 0;
  dye.setGroup(group);
  updateProgress();
  $('comments').hidden = true;
  renderInitialCard();
});
$('retry-video').addEventListener('click', () => { $('retry-video').hidden = true; currentCard.querySelector('video').load(); playCard(currentCard); });
function openComments() {
  $('comments').hidden = false;
  const comments = stats().comments;
  $('comments-total').textContent = comments.length;
  $('comment-list').replaceChildren();
  if (!comments.length) $('comment-list').textContent = '还没有评论，来写第一条吧。';
  for (const text of comments) {
    const p = document.createElement('p');
    const label = document.createElement('small'); label.textContent = '我 · 刚刚';
    p.append(label, document.createTextNode(text)); $('comment-list').append(p);
  }
}
$('close-comments').addEventListener('click', () => { $('comments').hidden = true; });
$('comment-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('comment-input').value.trim();
  if (!text) return;
  stats().comments.push(text);
  $('comment-input').value = '';
  currentCard.querySelector('[data-action=comment] span').textContent = stats().comments.length;
  openComments();
});
function closeCameraStream() {
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  camera.srcObject = null;
  camera.hidden = true;
}
function releaseCamera() {
  cameraGeneration++;
  cameraPending = false;
  dye.stop();
  closeCameraStream();
}
function showCameraError(message) {
  releaseCamera();
  $('camera-empty').hidden = false;
  $('camera-message').textContent = message;
  $('enable-camera').textContent = '重试摄像头 ↻';
  $('enable-camera').disabled = false;
  $('tracking-status').textContent = '';
  $('retry-effect').hidden = true;
}
async function playCameraPreview() {
  let timeout;
  try {
    await Promise.race([
      camera.play(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new DOMException('Camera preview timed out', 'TimeoutError')), 6000);
      }),
    ]);
    if (!camera.videoWidth) throw new DOMException('Camera returned no video', 'TimeoutError');
  } finally {
    clearTimeout(timeout);
  }
}
function cameraErrorMessage(error, preview) {
  switch (error.name) {
    case 'NotAllowedError':
      return preview ? '浏览器暂停了摄像头预览，请点击重试' : '摄像头访问被阻止，请在浏览器地址栏和系统隐私设置中检查权限';
    case 'NotFoundError':
      return '没有检测到摄像头，请检查设备是否连接';
    case 'NotReadableError':
    case 'AbortError':
      return '摄像头无法启动，可能被其他标签页或应用占用。关闭它们后重试';
    case 'TimeoutError':
      return '已连接摄像头，但没有收到画面。请关闭其他正在使用摄像头的页面或应用后重试';
    case 'OverconstrainedError':
      return '摄像头无法使用当前视频设置，请检查连接后重试';
    default:
      return '未能启动摄像头，请检查设备后重试';
  }
}
async function enableCamera() {
  if (cameraPending || stream) return;
  if (!navigator.mediaDevices?.getUserMedia) { $('camera-message').textContent = '请通过 localhost 或 HTTPS 打开，以使用摄像头'; return; }
  cameraPending = true;
  const generation = ++cameraGeneration;
  $('camera-message').textContent = '正在连接摄像头，如有提示请点击允许';
  $('enable-camera').disabled = true;
  const preferred = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } };
  for (const video of [preferred, true]) {
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      if (generation !== cameraGeneration) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      $('camera-message').textContent = '正在等待摄像头画面…';
      camera.muted = true;
      camera.hidden = false;
      camera.srcObject = stream;
      await playCameraPreview();
      if (generation !== cameraGeneration) return;
      const track = stream.getVideoTracks()[0];
      if (track?.readyState !== 'live') throw new DOMException('Camera stopped before preview', 'NotReadableError');
      track.addEventListener('ended', () => {
        if (generation === cameraGeneration) showCameraError('摄像头已断开，可以重新连接');
      }, { once: true });
      cameraPending = false;
      $('enable-camera').disabled = false;
      $('camera-empty').hidden = true;
      dye.start();
      return;
    } catch (error) {
      if (generation !== cameraGeneration) return;
      if (video === preferred && ['NotReadableError', 'AbortError', 'OverconstrainedError', 'TimeoutError'].includes(error.name)) {
        closeCameraStream();
        $('camera-message').textContent = '正在用默认设置重新连接摄像头…';
        continue;
      }
      showCameraError(cameraErrorMessage(error, Boolean(stream)));
      return;
    }
  }
}
$('enable-camera').addEventListener('click', enableCamera);
$('retry-effect').addEventListener('click', () => { if (stream) dye.start(); });
$('reset').addEventListener('click', () => {
  swipes = 0; index = 0; interactions.clear();
  updateProgress(); $('comments').hidden = true;
  renderInitialCard();
});
window.addEventListener('pagehide', () => { releaseCamera(); currentCard?.querySelector('video').pause(); });
window.addEventListener('pageshow', event => { if (event.persisted) { if (!document.hidden) enableCamera(); playCard(currentCard); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) currentCard?.querySelector('video').pause();
  else if (currentCard) playCard(currentCard);
});
renderInitialCard();
if (!document.hidden) enableCamera();
