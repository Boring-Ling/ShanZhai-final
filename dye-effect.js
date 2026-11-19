import { CHARACTER_FACES } from './character-faces.js?v=lulu-head-fit-1';
import { DyeRenderer } from './dye-renderer.js?v=lulu-head-fit-1';

// Each accepted video switch adds one step. Time alone never advances the dye.
const TOTAL_STEPS = 24;
const CHARACTER_STEPS = 12;

export class DyeEffect {
  constructor(video,canvas,features,onStatus) {
    this.video=video;this.canvas=canvas;this.features=features;this.onStatus=onStatus;
    this.worker=null;this.renderer=null;this.active=false;this.busy=false;
    this.ready=false;this.loading=false;this.failed=false;
    this.target=0;this.shown=0;this.group='nailong';this.generation=0;
    this.animationFrame=0;this.lastFrameTime=0;this.lastVideoTime=-1;this.lastDraw=0;
  }

  get label() {
    if (this.group === 'nailong') return '染色';
    if (this.group === 'jokebear') return '熊化';
    return CHARACTER_FACES[this.group] ? '卡通化' : '';
  }

  async start() {
    this.stop();
    this.active=true;this.failed=false;this.loading=true;
    const generation=++this.generation;
    this.report('正在加载本地特效…');
    try {
      if(!this.renderer) {
        const response=await fetch(new URL('./assets/vision/face-geometry.json',import.meta.url));
        if(!response.ok) throw new Error('面部网格加载失败');
        const geometry=await response.json();
        if(generation!==this.generation) return;
        this.renderer=new DyeRenderer(this.canvas,this.features,geometry);
      }
      if(generation!==this.generation) return;
      const worker=new Worker(new URL('./tracking-worker.js?v=three-faces-5',import.meta.url));
      this.worker=worker;
      worker.onmessage=({data})=>{
        if(generation!==this.generation) {data.bitmap?.close();return;}
        if(data.type==='ready') {
          this.loading=false;this.ready=true;
          this.canvas.dataset.delegate=data.delegate;
          this.report('请面向摄像头');this.schedule();
        }
        if(data.type==='frame') {
          this.busy=false;
          try {
            const now=performance.now();
            const delta=Math.min(1000,now-(this.lastDraw||now));
            this.lastDraw=now;
            this.shown+=(this.target-this.shown)*(1-Math.exp(-delta/320));
            const supported=Boolean(this.label);
            const character=Boolean(CHARACTER_FACES[this.group]);
            const featureStart=character?0.085:this.group==='jokebear'?0.38:0.72;
            const count=data.faces.length;
            this.renderer.draw(data,supported?this.shown:0,this.group);
            this.canvas.hidden=character||!count||!supported||this.shown<0.001;
            this.features.hidden=!count||!supported||this.shown<featureStart;
            this.canvas.dataset.face=count?'tracked':'missing';
            this.canvas.dataset.faceCount=count;
            this.canvas.dataset.inferenceMs=Math.round(data.inferenceMs);
            this.report(count?`${count} 人追踪中 · 每刷一条，增加一点`:'请面向摄像头 · 最多支持 3 人');
          } catch(error) {this.fail(error.message);}
          finally {data.bitmap.close();}
        }
        if(data.type==='error'||data.type==='frame-error') this.fail(data.message);
      };
      worker.onerror=()=>{if(generation===this.generation) this.fail('特效加载失败，点击重试');};
      worker.postMessage({type:'initialize'});
    } catch(error) {
      if(generation===this.generation) this.fail(error.message);
    }
  }

  schedule() {
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame=requestAnimationFrame(time=>this.tick(time));
  }

  tick(time) {
    if(!this.active||!this.ready) return;
    const generation=this.generation;
    if(!this.busy&&this.video.readyState>=2&&this.video.currentTime!==this.lastVideoTime&&time-this.lastFrameTime>45) {
      this.busy=true;this.lastFrameTime=time;this.lastVideoTime=this.video.currentTime;
      const width=Math.min(960,this.video.videoWidth);
      const height=Math.round(width*this.video.videoHeight/this.video.videoWidth);
      createImageBitmap(this.video,{resizeWidth:width,resizeHeight:height}).then(bitmap=>{
        if(generation!==this.generation||!this.worker) {bitmap.close();return;}
        const fitHair = this.target > .48 && Boolean(CHARACTER_FACES[this.group]?.headCenter);
        this.worker.postMessage({type:'frame',bitmap,timestamp:time,segment:this.group==='nailong'||this.group==='jokebear'||fitHair},[bitmap]);
      }).catch(()=>{if(generation===this.generation) this.busy=false;});
    }
    this.schedule();
  }

  setProgress(steps) {
    const totalSteps = CHARACTER_FACES[this.group] ? CHARACTER_STEPS : TOTAL_STEPS;
    this.target=Math.min(1,Math.max(0,steps/totalSteps));
    if(!steps) {this.shown=0;this.canvas.hidden=true;this.features.hidden=true;}
  }

  setGroup(group) {
    this.group=group;this.setProgress(0);
    this.report(this.ready?'请面向摄像头':'正在加载本地特效…');
  }

  report(message) {
    this.onStatus(this.label||this.failed?message:'此内容池暂显示实时原画面',this.failed);
  }

  fail(message) {
    this.failed=true;this.loading=false;this.ready=false;this.busy=false;
    cancelAnimationFrame(this.animationFrame);
    this.worker?.terminate();this.worker=null;
    this.canvas.hidden=true;this.features.hidden=true;
    this.report(message);
  }

  stop() {
    this.generation++;this.active=false;this.ready=false;this.loading=false;this.busy=false;
    cancelAnimationFrame(this.animationFrame);
    this.worker?.terminate();this.worker=null;
    this.canvas.hidden=true;this.features.hidden=true;
    this.lastVideoTime=-1;this.lastDraw=0;
  }
}
