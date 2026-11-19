const vertexSource = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 faceUV;
varying vec2 videoUV;
void main() {
  gl_Position = vec4(position.x * 2.0 - 1.0, 1.0 - position.y * 2.0, 0.0, 1.0);
  faceUV = uv;
  videoUV = position;
}`;

const sharedFragment = `
precision mediump float;
varying vec2 faceUV;
varying vec2 videoUV;
uniform sampler2D cameraTexture;
uniform sampler2D skinTexture;
uniform sampler2D growthTexture;
uniform float progress;
uniform float faceVisible;
uniform vec2 faceCenter;
uniform vec2 faceAxis;
uniform float faceScale;
uniform float frameAspect;
uniform vec4 leftEye;
uniform vec4 rightEye;
uniform vec4 mouth;
uniform vec3 dyeColor;
float spread(vec2 uv, float amount) {
  float field = texture2D(growthTexture, clamp(uv, 0.0, 1.0)).r;
  return smoothstep(field - 0.018, field + 0.018, amount * 1.08 - 0.035);
}`;

const bodyFragment = sharedFragment + `
uniform int bodyFaceCount;
uniform vec2 bodyFaceCenters[3];
uniform vec2 bodyFaceAxes[3];
uniform float bodyFaceScales[3];
void main() {
  vec3 camera = texture2D(cameraTexture, videoUV).rgb;
  vec2 skinUV = videoUV;
  float bodySkin = texture2D(skinTexture, skinUV).r;
  float bodyProgress = clamp((progress - 0.30) / 0.70, 0.0, 1.0);
  float nearest = 10000.0;
  float dye = 0.0;
  for(int i=0;i<3;i++) {
    if(i<bodyFaceCount) {
      vec2 offset = skinUV - bodyFaceCenters[i];
      offset.x *= frameAspect;
      vec2 axis = bodyFaceAxes[i];
      vec2 vertical = vec2(-axis.y, axis.x);
      vec2 localUV = vec2(dot(offset, axis), dot(offset, vertical)) / max(bodyFaceScales[i], 0.01);
      float distance = length(localUV - vec2(0.0, 0.85));
      if(distance<nearest) {
        nearest = distance;
        dye = spread(localUV * 0.26 + vec2(0.5, 0.16), bodyProgress);
      }
    }
  }
  dye *= bodySkin * faceVisible * step(0.001, bodyProgress);
  gl_FragColor = vec4(mix(camera, dyeColor, dye), 1.0);
}`;

const faceFragment = sharedFragment + `
uniform float blueBangs;
uniform float characterHead;
float featureHole(vec4 feature) {
  return 1.0 - smoothstep(0.74, 1.08, length((faceUV - feature.xy) / feature.zw));
}
void main() {
  float faceSkin = texture2D(skinTexture, videoUV).g;
  float dye = spread(faceUV, min(progress / 0.88, 1.0));
  // The mesh already follows the face. Relying on skin classification here
  // cuts holes around glasses and shadows in the new masks.
  dye *= mix(faceSkin, 1.0, characterHead) * faceVisible * step(0.001, progress);
  float holes = max(max(featureHole(leftEye), featureHole(rightEye)), featureHole(mouth));
  dye *= 1.0 - holes * (1.0 - smoothstep(0.70, 0.94, progress));
  float hairline = 0.69 + 0.18 * exp(-24.0 * abs(faceUV.x - 0.5));
  vec3 color = mix(dyeColor, vec3(0.46, 0.61, 0.71), blueBangs * step(hairline, faceUV.y));
  gl_FragColor = vec4(color, dye);
}`;

export const CHARACTER_HEADS = {
  chiikawa: { ears: 'round', earColor: '#faf2f5', dye: [0.98, 0.95, 0.96] },
  hachiware: { ears: 'pointed', earColor: '#759cb5', dye: [0.98, 0.95, 0.96] },
  usagi: { ears: 'long', earColor: '#fff0c9', dye: [1, 0.94, 0.79] },
};

function createProgram(gl, fragmentSource) {
  const shaders = [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]].map(([kind, source]) => {
    const shader = gl.createShader(kind);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  });
  const program = gl.createProgram();
  shaders.forEach(shader => gl.attachShader(program, shader));
  gl.linkProgram(program); shaders.forEach(shader => gl.deleteShader(shader));
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const uniforms = {};
  for (const name of ['cameraTexture', 'skinTexture', 'growthTexture', 'dyeColor', 'progress', 'faceVisible', 'faceCenter', 'faceAxis', 'faceScale', 'frameAspect', 'leftEye', 'rightEye', 'mouth', 'blueBangs', 'characterHead']) uniforms[name] = gl.getUniformLocation(program, name);
  for (const name of ['bodyFaceCenters','bodyFaceAxes','bodyFaceScales']) uniforms[name]=gl.getUniformLocation(program,name+'[0]');
  uniforms.bodyFaceCount=gl.getUniformLocation(program,'bodyFaceCount');
  return { program, uniforms, position: gl.getAttribLocation(program, 'position'), uv: gl.getAttribLocation(program, 'uv') };
}

function noise(x, y) {
  const hash = (a, b) => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy) * (1-sx) + hash(ix+1, iy) * sx;
  const b = hash(ix, iy+1) * (1-sx) + hash(ix+1, iy+1) * sx;
  return a * (1-sy) + b * sy;
}

function growthField(geometry) {
  const size = 256;
  const points = [50, 280, 10, 152].map(i => geometry.uv.slice(i*2, i*2+2));
  const field = new Float32Array(size*size);
  for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
    const u=x/(size-1), v=y/(size-1);
    let distance=1;
    points.forEach(([px,py],i) => { distance = Math.min(distance, Math.hypot((u-px)*1.1,v-py) + i*0.055); });
    field[y*size+x] = distance + noise(u*14,v*14)*0.065 + noise(u*37,v*37)*0.025;
  }
  // Rank the growth within the face oval, so most coverage does not arrive early.
  const oval=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
  const faceCanvas=document.createElement('canvas');faceCanvas.width=faceCanvas.height=size;
  const context=faceCanvas.getContext('2d');context.beginPath();
  oval.forEach((point,i)=>{const x=geometry.uv[point*2]*size,y=geometry.uv[point*2+1]*size;if(i)context.lineTo(x,y);else context.moveTo(x,y);});
  context.closePath();context.fill();
  const faceMask=context.getImageData(0,0,size,size).data;
  const sorted=Float32Array.from(field.filter((_,i)=>faceMask[i*4+3]>127)).sort();
  const result = new Uint8Array(field.length);
  for (let i=0; i<field.length; i++) {
    let low=0, high=sorted.length;
    while(low<high) { const middle=(low+high)>>>1; if(sorted[middle]<field[i]) low=middle+1; else high=middle; }
    result[i]=Math.round(low/sorted.length*255);
  }
  return { size, data: result };
}

export class DyeRenderer {
  constructor(canvas, features, geometry) {
    this.canvas=canvas; this.features=features; this.geometry=geometry;
    this.context=features.getContext('2d');
    this.bodyCenters=new Float32Array(6);this.bodyAxes=new Float32Array(6);this.bodyScales=new Float32Array(3);
    const gl=canvas.getContext('webgl', { alpha:false, antialias:true, premultipliedAlpha:false });
    if (!gl) throw new Error('此浏览器未能开启 WebGL，请尝试 Chrome 或 Edge。');
    this.gl=gl;
    this.bodyProgram=createProgram(gl,bodyFragment);
    this.faceProgram=createProgram(gl,faceFragment);
    gl.useProgram(this.faceProgram.program);
    for (const [name,a,b,height] of [['leftEye',33,133,0.022],['rightEye',362,263,0.022],['mouth',61,291,0.034]]) {
      const uv=geometry.uv;
      gl.uniform4f(this.faceProgram.uniforms[name],(uv[a*2]+uv[b*2])/2,(uv[a*2+1]+uv[b*2+1])/2,Math.abs(uv[b*2]-uv[a*2])*.63,height);
    }
    this.quad=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,0,1,1,0,1,1]),gl.STATIC_DRAW);
    this.positions=gl.createBuffer();
    this.uv=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,this.uv);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(geometry.uv),gl.STATIC_DRAW);
    this.indices=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(geometry.triangles),gl.STATIC_DRAW);
    this.vertexData=new Float32Array(468*2);
    this.textures=[0,1,2].map(unit => {
      gl.activeTexture(gl.TEXTURE0+unit);
      const texture=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      return texture;
    });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.activeTexture(gl.TEXTURE1);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,255,0,255]));
    const growth=growthField(geometry);
    gl.activeTexture(gl.TEXTURE2);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,growth.size,growth.size,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,growth.data);
    this.skinBuffer=null;
  }

  useProgram(program, face, progress) {
    const gl=this.gl, u=program.uniforms;
    gl.useProgram(program.program);
    gl.uniform1i(u.cameraTexture,0); gl.uniform1i(u.skinTexture,1); gl.uniform1i(u.growthTexture,2);
    gl.uniform1f(u.progress,progress); gl.uniform1f(u.faceVisible,face?1:0);
    const character = CHARACTER_HEADS[this.group];
    if(character) gl.uniform3f(u.dyeColor, ...character.dye);
    else if(this.group==='jokebear') gl.uniform3f(u.dyeColor,1,1,1);
    else gl.uniform3f(u.dyeColor,1.0,0.91,0.27);
    if (u.blueBangs) gl.uniform1f(u.blueBangs, this.group === 'hachiware' ? 1 : 0);
    if (u.characterHead) gl.uniform1f(u.characterHead, character ? 1 : 0);
    const aspect=this.canvas.width/this.canvas.height;
    gl.uniform1f(u.frameAspect,aspect);
    if(face) {
      const left=face[234],right=face[454];
      const dx=(right.x-left.x)*aspect,dy=right.y-left.y;
      const scale=Math.hypot(dx,dy);
      gl.uniform2f(u.faceCenter,(right.x+left.x)/2,(right.y+left.y)/2);
      gl.uniform2f(u.faceAxis,dx/scale,dy/scale);
      gl.uniform1f(u.faceScale,scale);
    }
  }

  attribute(location,buffer) {
    if(location<0) return;
    const gl=this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
  }

  draw({bitmap,faces,skin},progress,group='nailong') {
    this.group=group;
    const character = CHARACTER_HEADS[group];
    // Nearer/larger heads draw last. No array-index state can jump to another person.
    const visible=faces.slice(0,3).sort((a,b)=>{
      const size=({landmarks:f})=>Math.hypot(f[454].x-f[234].x,f[454].y-f[234].y);
      return size(a)-size(b);
    });
    const gl=this.gl;
    if(this.canvas.width!==bitmap.width||this.canvas.height!==bitmap.height) {
      this.canvas.width=this.features.width=bitmap.width;
      this.canvas.height=this.features.height=bitmap.height;
      gl.viewport(0,0,bitmap.width,bitmap.height);
    }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.textures[0]);
    // ImageBitmap and segmentation rows are both sampled in top-to-bottom order.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
    if(skin) {
      if(this.skinBuffer?.length!==skin.data.length*4) this.skinBuffer=new Uint8Array(skin.data.length*4);
      for(let i=0;i<skin.data.length;i++) {
        this.skinBuffer[i*4]=skin.data[i]===2?255:0;
        this.skinBuffer[i*4+1]=skin.data[i]===3?255:0;
        this.skinBuffer[i*4+2]=0;this.skinBuffer[i*4+3]=255;
      }
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,this.textures[1]);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,skin.width,skin.height,0,gl.RGBA,gl.UNSIGNED_BYTE,this.skinBuffer);
    }
    gl.disable(gl.BLEND);
    this.context.clearRect(0,0,this.features.width,this.features.height);
    this.useProgram(this.bodyProgram,visible[0]?.landmarks,group==='jokebear'||character?0:progress);
    const aspect=bitmap.width/bitmap.height;
    visible.forEach(({landmarks:face},index)=>{
      const a=face[234],b=face[454],dx=(b.x-a.x)*aspect,dy=b.y-a.y,scale=Math.max(.001,Math.hypot(dx,dy));
      this.bodyCenters.set([(a.x+b.x)/2,(a.y+b.y)/2],index*2);
      this.bodyAxes.set([dx/scale,dy/scale],index*2);this.bodyScales[index]=scale;
    });
    gl.uniform1i(this.bodyProgram.uniforms.bodyFaceCount,visible.length);
    gl.uniform2fv(this.bodyProgram.uniforms.bodyFaceCenters,this.bodyCenters);
    gl.uniform2fv(this.bodyProgram.uniforms.bodyFaceAxes,this.bodyAxes);
    gl.uniform1fv(this.bodyProgram.uniforms.bodyFaceScales,this.bodyScales);
    this.attribute(this.bodyProgram.position,this.quad);this.attribute(this.bodyProgram.uv,this.quad);
    gl.drawArrays(gl.TRIANGLES,0,6);
    for(const {landmarks:face} of visible) {
      for(let i=0;i<468;i++) {this.vertexData[i*2]=face[i].x;this.vertexData[i*2+1]=face[i].y;}
      gl.bindBuffer(gl.ARRAY_BUFFER,this.positions);gl.bufferData(gl.ARRAY_BUFFER,this.vertexData,gl.DYNAMIC_DRAW);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      this.useProgram(this.faceProgram,face,character ? progress * 0.89 : progress);
      this.attribute(this.faceProgram.position,this.positions);this.attribute(this.faceProgram.uv,this.uv);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indices);
      gl.drawElements(gl.TRIANGLES,this.geometry.triangles.length,gl.UNSIGNED_SHORT,0);
      gl.disable(gl.BLEND);
    }
    for(const {landmarks:face,expressions} of visible) {
      if(character) this.drawCharacterFeatures(face, expressions, progress, character);
      else if(group==='jokebear') this.drawJokeBear(face,expressions,progress);
      else this.drawFeatures(face,expressions,progress);
    }
  }

  drawCharacterFeatures(face, expressions, progress, design) {
    if (progress < 0.10) return;
    const ctx = this.context;
    const { width, height } = this.features;
    const left = face[234], right = face[454];
    const dx = (right.x - left.x) * width, dy = (right.y - left.y) * height;
    const faceWidth = Math.hypot(dx, dy);
    if (faceWidth < 2) return;
    const angle = Math.atan2(dy, dx);
    const grow = (start, end) => {
      const u = Math.max(0, Math.min(1, (progress - start) / (end - start)));
      return u * u * (3 - 2 * u);
    };
    const at = (a, b = a) => {
      ctx.translate((face[a].x + face[b].x) * width / 2, (face[a].y + face[b].y) * height / 2);
      ctx.rotate(angle);
      ctx.scale(faceWidth, faceWidth);
    };
    const ink = '#493026';
    const ellipse = (x, y, rx, ry, rotation, color) => {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rotation, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    };

    const blush = grow(.10, .29);
    for (const cheek of [50, 280]) {
      ctx.save();
      at(cheek);
      ctx.scale(blush, blush);
      ellipse(0, 0, .084, .055, 0, '#f3a6b7');
      ctx.strokeStyle = ink;
      ctx.lineCap = 'round';
      ctx.lineWidth = .011;
      ctx.beginPath();
      for (const x of [-.034, 0, .034]) {
        ctx.moveTo(x - .009, .014);
        ctx.lineTo(x + .009, -.014);
      }
      ctx.stroke();
      ctx.restore();
    }

    const eyes = grow(.57, .85);
    if (eyes > 0) {
      for (const [a, b, blinkName] of [[33, 133, 'eyeBlinkLeft'], [362, 263, 'eyeBlinkRight']]) {
        const blink = expressions.find(item => item.categoryName === blinkName)?.score || 0;
        ctx.save();
        at(a, b);
        ctx.scale(eyes, eyes * Math.max(.18, 1 - blink * .9));
        ellipse(0, 0, .063, .065, 0, ink);
        ellipse(-.012, -.018, .022, .019, 0, '#fff9f5');
        ellipse(.008, .030, .019, .007, 0, '#fff9f5');
        ctx.restore();
      }
    }

    const mouth = grow(.66, .92);
    if (mouth > 0) {
      ctx.save();
      at(61, 291);
      ctx.scale(mouth, mouth);
      ctx.strokeStyle = ink;
      ctx.lineCap = 'round';
      ctx.lineWidth = .016;
      ctx.beginPath();
      ctx.moveTo(-.077, -.014);
      ctx.quadraticCurveTo(-.071, .048, 0, .008);
      ctx.quadraticCurveTo(.071, .048, .077, -.014);
      ctx.moveTo(0, -.027);
      ctx.lineTo(0, .008);
      ctx.stroke();
      ctx.restore();
    }

    const ears = grow(.73, 1);
    if (ears > 0) {
      ctx.save();
      at(10);
      const separation = design.ears === 'long' ? .11 : .28;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * separation, -.036);
        ctx.scale(ears, ears);
        ctx.strokeStyle = ink;
        ctx.lineWidth = .020;
        ctx.lineJoin = 'round';
        if (design.ears === 'pointed') {
          ctx.beginPath();
          ctx.moveTo(-.103, .026);
          ctx.quadraticCurveTo(-.081, -.065, side * .069, -.157);
          ctx.quadraticCurveTo(.105, -.084, .103, .026);
          ctx.quadraticCurveTo(0, .069, -.103, .026);
          ctx.fillStyle = design.earColor;
          ctx.fill();
          ctx.stroke();
        } else {
          const long = design.ears === 'long';
          ctx.rotate(long ? -.27 + side * .08 : side * .14);
          ctx.beginPath();
          ctx.ellipse(0, long ? -.15 : -.052, long ? .059 : .081, long ? .184 : .077, 0, 0, 2 * Math.PI);
          ctx.fillStyle = design.earColor;
          ctx.fill();
          ctx.stroke();
          if (long) ellipse(0, -.16, .031, .122, 0, '#f4adbe');
        }
        ctx.restore();
      }
      ctx.restore();
    }
  }

  drawJokeBear(face,expressions,progress) {
    const ctx=this.context,w=this.features.width,h=this.features.height;
    if(progress<0.38) return;
    const ease=(start,end)=>{
      const t=Math.max(0,Math.min(1,(progress-start)/(end-start)));
      return t*t*(3-2*t);
    };
    const point=i=>({x:face[i].x*w,y:face[i].y*h});
    const a=point(234),b=point(454),top=point(10),chin=point(152);
    const eyeLeft={x:(face[33].x+face[133].x)*w/2,y:(face[33].y+face[133].y)*h/2};
    const eyeRight={x:(face[362].x+face[263].x)*w/2,y:(face[362].y+face[263].y)*h/2};
    const angle=Math.atan2(eyeRight.y-eyeLeft.y,eyeRight.x-eyeLeft.x);
    const height=Math.hypot(chin.x-top.x,chin.y-top.y);
    const width=Math.hypot(b.x-a.x,b.y-a.y);
    const pose={x:(eyeLeft.x+eyeRight.x)/2-Math.sin(angle)*height*.16,
      y:(eyeLeft.y+eyeRight.y)/2+Math.cos(angle)*height*.16,width,angle};
    const round=ease(.38,.94),details=ease(.56,.87);
    const rx=width*(.52+.22*round),ry=rx*.85;
    const local=p=>({x:(p.x-pose.x)*Math.cos(angle)+(p.y-pose.y)*Math.sin(angle),
      y:-(p.x-pose.x)*Math.sin(angle)+(p.y-pose.y)*Math.cos(angle)});
    const expression=name=>expressions.find(item=>item.categoryName===name)?.score||0;
    const fill=path=>{
      ctx.fillStyle='#fff';ctx.fill(path);
      ctx.strokeStyle='#111';ctx.lineWidth=rx*.06;ctx.lineJoin='round';ctx.stroke(path);
    };
    ctx.save();ctx.translate(pose.x,pose.y);ctx.rotate(pose.angle);
    ctx.scale(rx,ry);
    const head=new Path2D();
    // One continuous contour keeps ears joined to the approved rounded cheek shape.
    head.moveTo(-.54,-.86);
    head.bezierCurveTo(-.50,-1.15,-.85,-1.18,-.90,-.95);
    head.bezierCurveTo(-1.00,-.72,-.85,-.59,-.78,-.62);
    head.bezierCurveTo(-.92,-.39,-1.01,-.09,-1,.16);
    head.bezierCurveTo(-.99,.60,-.65,.98,0,1);
    head.bezierCurveTo(.65,.98,.99,.60,1,.16);
    head.bezierCurveTo(1.01,-.09,.92,-.39,.78,-.62);
    head.bezierCurveTo(.85,-.59,1.00,-.72,.90,-.95);
    head.bezierCurveTo(.85,-1.18,.50,-1.15,.54,-.86);
    head.bezierCurveTo(.18,-1.04,-.18,-1.04,-.54,-.86);head.closePath();
    ctx.scale(1/rx,1/ry);
    const silhouette=new Path2D();silhouette.addPath(head,new DOMMatrix().scale(rx,ry));
    // Rounded opaque patches grow into one silhouette; no flat wipe or opacity fade.
    ctx.save();ctx.beginPath();
    for(const [x,y] of [[-.58,.22],[.57,.20],[0,-.70],[0,.65]]) {
      const radius=rx*round*2.2;ctx.moveTo(x*rx+radius,y*ry);ctx.arc(x*rx,y*ry,radius,0,Math.PI*2);
    }
    ctx.clip();fill(silhouette);
    ctx.restore();
    if(details>0) {
      ctx.fillStyle='#1c1b1a';ctx.strokeStyle='#1c1b1a';ctx.lineCap='round';ctx.lineJoin='round';
      for(const [p,blinkName] of [[eyeLeft,'eyeBlinkLeft'],[eyeRight,'eyeBlinkRight']]) {
        const eye=local(p);
        const blink=Math.max(.16,1-expression(blinkName));
        ctx.beginPath();ctx.ellipse(eye.x,eye.y,rx*.064*details,rx*.064*details*blink,0,0,Math.PI*2);ctx.fill();
      }
      const nose=local(point(1));
      ctx.beginPath();ctx.moveTo(nose.x-rx*.078,nose.y);ctx.quadraticCurveTo(nose.x,nose.y-ry*.04,nose.x+rx*.078,nose.y);
      ctx.quadraticCurveTo(nose.x+rx*.055,nose.y+ry*.06,nose.x,nose.y+ry*.105);ctx.quadraticCurveTo(nose.x-rx*.055,nose.y+ry*.06,nose.x-rx*.078,nose.y);ctx.fill();
      ctx.lineWidth=rx*.05*details;
      ctx.beginPath();ctx.moveTo(nose.x,nose.y+ry*.08);ctx.lineTo(nose.x,nose.y+ry*.12);
      ctx.bezierCurveTo(nose.x-rx*.05,nose.y+ry*.24,nose.x-rx*.18,nose.y+ry*.24,nose.x-rx*.20,nose.y+ry*.15);
      ctx.moveTo(nose.x,nose.y+ry*.12);ctx.bezierCurveTo(nose.x+rx*.05,nose.y+ry*.24,nose.x+rx*.18,nose.y+ry*.24,nose.x+rx*.20,nose.y+ry*.15);ctx.stroke();
      const open=expression('jawOpen');
      if(open>.16) {ctx.beginPath();ctx.ellipse(nose.x,nose.y+ry*.25,rx*.055,ry*.12*open,0,0,Math.PI*2);ctx.fill();}
    }
    ctx.restore();
  }

  drawFeatures(face,expressions,progress) {
    const ctx=this.context,w=this.features.width,h=this.features.height;
    if(progress<0.72) return;
    const opacity=Math.min(1,(progress-0.72)/0.25);
    const point=i=>({x:face[i].x*w,y:face[i].y*h});
    const left=point(234),right=point(454);
    const width=Math.hypot(right.x-left.x,right.y-left.y);
    const angle=Math.atan2(right.y-left.y,right.x-left.x);
    const expression=name=>expressions.find(item=>item.categoryName===name)?.score||0;
    ctx.save();ctx.globalAlpha=opacity;
    for(const eye of [{a:33,b:133,blink:'eyeBlinkLeft'},{a:362,b:263,blink:'eyeBlinkRight'}]) {
      const a=point(eye.a),b=point(eye.b);
      const x=(a.x+b.x)/2,y=(a.y+b.y)/2;
      const blink=Math.max(0.08,1-expression(eye.blink)*0.95);
      const radius=Math.hypot(b.x-a.x,b.y-a.y)*0.78;
      ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.scale(1,blink);
      ctx.beginPath();ctx.ellipse(0,0,radius,radius*1.12,0,0,Math.PI*2);
      const iris=ctx.createRadialGradient(-radius*.25,-radius*.3,1,0,0,radius*1.2);
      iris.addColorStop(0,'#b6d56b');iris.addColorStop(1,'#76b44e');
      ctx.fillStyle=iris;ctx.fill();
      ctx.beginPath();ctx.ellipse(0,radius*.08,radius*.43,radius*.55,0,0,Math.PI*2);
      ctx.fillStyle='#102019';ctx.fill();
      ctx.beginPath();ctx.ellipse(-radius*.12,-radius*.2,radius*.11,radius*.14,0,0,Math.PI*2);
      ctx.fillStyle='#eaf0bc';ctx.fill();ctx.restore();
    }
    const a=point(61),b=point(291),upper=point(13),lower=point(14);
    const mouthWidth=Math.hypot(b.x-a.x,b.y-a.y)*1.15;
    const mouthOpen=Math.min(width*.16,Math.hypot(lower.x-upper.x,lower.y-upper.y));
    ctx.save();ctx.translate((a.x+b.x)/2,(a.y+b.y)/2);ctx.rotate(angle);
    const mouthHeight=Math.max(width*.035,mouthOpen*.8);
    ctx.beginPath();ctx.moveTo(-mouthWidth*.53,-mouthHeight*.22);
    ctx.quadraticCurveTo(0,mouthHeight*.55,mouthWidth*.53,-mouthHeight*.22);
    ctx.quadraticCurveTo(0,mouthHeight*1.85,-mouthWidth*.53,-mouthHeight*.22);
    const shadow=ctx.createLinearGradient(0,0,0,mouthHeight*1.3);
    shadow.addColorStop(0,'#6d5215');shadow.addColorStop(1,'#c0a92f');ctx.fillStyle=shadow;ctx.fill();
    ctx.restore();ctx.restore();
  }
}
