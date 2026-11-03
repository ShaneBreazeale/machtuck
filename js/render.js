// WebGL2 renderer: single full-screen raymarched fragment shader (sky, procedural Florida coast, volumetric
// storm + cloud deck, SDF Learjet) plus a line program for the ADS-B ghost track and the player trail.
const VS_QUAD = `#version 300 es
in vec2 aPos; out vec2 vUv; void main(){ vUv=aPos; gl_Position=vec4(aPos,0.,1.); }`;

const FS_SCENE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform vec2 uRes; uniform float uTime;
uniform vec3 uCamPos; uniform mat3 uCam; uniform float uTanFov;
uniform vec3 uSun;
uniform vec3 uAcPos; uniform mat3 uAcRot; uniform int uExt; uniform int uStabGone;
uniform vec3 uGhPos; uniform mat3 uGhRot; uniform int uGhost;
uniform vec3 uStorm; uniform float uStormR, uStormBase, uFlash, uQual, uCloudBase, uCloudTop;
uniform highp sampler3D uNexA, uNexB; uniform float uNexMix; uniform vec3 uNexO, uNexS; uniform int uUseNex;

float hash1(float n){ return fract(sin(n)*43758.5453); }
float hash2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise3(vec3 x){ vec3 p=floor(x), f=fract(x); f=f*f*(3.-2.*f); float n=p.x+p.y*57.+p.z*113.;
  return mix(mix(mix(hash1(n),hash1(n+1.),f.x),mix(hash1(n+57.),hash1(n+58.),f.x),f.y),
             mix(mix(hash1(n+113.),hash1(n+114.),f.x),mix(hash1(n+170.),hash1(n+171.),f.x),f.y),f.z); }
float noise2(vec2 x){ vec2 p=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(hash2(p),hash2(p+vec2(1,0)),f.x),mix(hash2(p+vec2(0,1)),hash2(p+vec2(1,1)),f.x),f.y); }
float fbm3(vec3 p){ float a=0.5, s=0.; for(int i=0;i<4;i++){ s+=a*noise3(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5;} return s; }
float fbm3l(vec3 p){ float a=0.5, s=0.; for(int i=0;i<2;i++){ s+=a*noise3(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5;} return s; }

// ---------------- Sky ----------------
vec3 skyCol(vec3 rd){
  float y=max(rd.y,0.);
  float dark=clamp(uCamPos.y/13000.,0.,1.);
  vec3 zen=mix(vec3(0.12,0.26,0.55),vec3(0.03,0.07,0.22),dark);
  vec3 hor=vec3(0.62,0.70,0.80);
  vec3 c=mix(hor,zen,pow(y,0.5));
  float s=max(dot(rd,uSun),0.);
  c+=vec3(1.,0.92,0.75)*pow(s,900.)*10.+vec3(1.,0.85,0.65)*pow(s,6.)*0.18;
  return c;
}

// ---------------- Ground (Florida, origin = KPBI, x east, z north) ----------------
vec3 groundCol(vec3 p, float t, vec3 rd){
  float e=p.x, n=p.z;
  float coastX=9000.+700.*sin(n*0.00011+1.)+300.*sin(n*0.00047+0.5);
  float lake=length(vec2(e+56000.,n-26000.))-24000.;
  bool ocean=e>coastX, lagoon=(e>coastX-2100.&&e<coastX-1400.);
  vec2 g=vec2(e,n)/1609.34; vec2 cell=floor(g), f=fract(g);
  float h1=hash2(cell);
  float urb=smoothstep(-26000.,4000.,e)*(1.-smoothstep(coastX-2200.,coastX-1900.,e))+smoothstep(coastX-1500.,coastX-1300.,e)*0.8;
  float big=noise2(vec2(e,n)*0.00012);
  vec3 veg=mix(vec3(0.19,0.30,0.13),vec3(0.38,0.42,0.22),noise2(vec2(e,n)*0.0006)*0.7+big*0.3);
  float wet=smoothstep(-14000.,-26000.,e);
  veg=mix(veg,mix(vec3(0.30,0.34,0.17),vec3(0.17,0.22,0.14),noise2(vec2(e,n)*0.0009)),wet);
  // farm fields (Belle Glade sugar) far west
  float farm=smoothstep(-30000.,-40000.,e)*(1.-step(0.,lake));
  vec3 fieldc=mix(vec3(0.45,0.38,0.22),vec3(0.25,0.40,0.15),hash2(floor(vec2(e,n)/800.)));
  veg=mix(veg,fieldc,farm);
  // urban blocks
  vec2 bc=floor(vec2(e,n)/180.); float hb=hash2(bc);
  vec3 roof=mix(vec3(0.46,0.43,0.40),vec3(0.78,0.74,0.68),hb);
  float isUrb=step(h1*0.9+0.05,urb);
  vec3 col=mix(veg,mix(roof,veg,0.35*hash2(bc+3.1)),isUrb);
  // roads: mile grid, wider with distance so they stay visible
  float rw=12.+t*0.004;
  float road=max(step(f.x*1609.34,rw),step(f.y*1609.34,rw))*mix(0.35,1.,urb);
  road=max(road, max(step(abs(fract(g.x*4.)*402.)-rw*0.6,0.)*isUrb*0.6, step(abs(fract(g.y*4.)*402.)-rw*0.6,0.)*isUrb*0.6)*step(t,20000.));
  col=mix(col,vec3(0.52,0.52,0.50),clamp(road,0.,1.));
  // I-95 and Turnpike (N-S)
  float i95=abs(e-(coastX-5200.+300.*sin(n*0.0002)))-(28.+t*0.004);
  float tpk=abs(e-(-6500.+400.*sin(n*0.00015)))-(24.+t*0.004);
  col=mix(col,vec3(0.42,0.42,0.42),step(i95,0.)+step(tpk,0.));
  // KPBI runways (10L/28R at origin, heading 100), 10R/28L offset south
  vec2 rp=vec2(e,n); float ang=-(100.-90.)*0.017453; mat2 rot=mat2(cos(ang),-sin(ang),sin(ang),cos(ang));
  vec2 q1=rot*rp; vec2 q2=rot*(rp-vec2(-400.,-1050.));
  float rwy=step(abs(q1.x),1524.)*step(abs(q1.y),23.+t*0.003) + step(abs(q2.x),1000.)*step(abs(q2.y),23.+t*0.003);
  float apron=step(abs(q1.x),1700.)*step(abs(q1.y-250.),300.)*0.5;
  col=mix(col,vec3(0.30,0.30,0.32),clamp(rwy,0.,1.)); col=mix(col,vec3(0.5,0.5,0.5),apron*(1.-rwy));
  // sand strip, water
  vec3 water=mix(vec3(0.03,0.20,0.30),vec3(0.05,0.32,0.42),smoothstep(0.,6000.,e-coastX));
  float beach=smoothstep(coastX-90.,coastX,e)*(1.-step(coastX,e));
  col=mix(col,vec3(0.85,0.80,0.65),beach);
  if(ocean||lagoon||lake<0.){
    vec3 nrm=normalize(vec3(noise2(vec2(e,n)*0.02+uTime*0.3)-0.5,8.,noise2(vec2(e,n)*0.02-uTime*0.2)-0.5));
    vec3 r=reflect(rd,nrm); float sp=pow(max(dot(r,uSun),0.),120.);
    float fr=pow(1.-max(dot(-rd,nrm),0.),4.);
    col=mix(water,skyCol(r)*0.6,0.25+0.6*fr)+vec3(1.,0.95,0.8)*sp*1.5;
  }
  // storm shadow + rain shaft
  vec2 sxz=p.xz-(uStorm.xz-uSun.xz*9000.);
  float shad=1.-smoothstep(uStormR*0.9,uStormR*1.8,length(sxz));
  col*=1.-0.6*shad;
  float shaft=1.-smoothstep(uStormR*0.4,uStormR*0.9,length(p.xz-uStorm.xz));
  col=mix(col,vec3(0.35,0.37,0.40),shaft*0.75);
  return col*(0.42+0.58*max(uSun.y,0.));
}

// ---------------- Clouds ----------------
float cloudDensity(vec3 p){
  float d=0.;
  if(p.y>uCloudBase&&p.y<uCloudTop){
    float hf=(p.y-uCloudBase)/(uCloudTop-uCloudBase);
    float shape=smoothstep(0.,0.12,hf)*(1.-smoothstep(0.65,1.,hf));
    float n=fbm3(p*vec3(1.,2.2,1.)*0.00024+vec3(uTime*0.002,0.,0.));
    d+=max(0.,n-0.47)*shape*3.5;
  }
  if(uUseNex==1){
    vec3 uvw=(p-uNexO)/uNexS;
    if(all(greaterThan(uvw,vec3(0.002)))&&all(lessThan(uvw,vec3(0.998)))){
      float enc=mix(texture(uNexA,uvw).r,texture(uNexB,uvw).r,uNexMix)*255.;
      if(enc>2.){
        float dbz=enc/4.-10.;
        float n=fbm3(p*0.0006+vec3(0.,-uTime*0.01,0.));
        // 2-10 dBZ: cloud (IMC). 10-30 dBZ: rain, translucent (visibility of a few km). >30 dBZ: the dense dark body.
        float cloudy=smoothstep(2.,8.,dbz)*(1.-smoothstep(10.,18.,dbz));
        float rain=smoothstep(10.,20.,dbz);
        float core=smoothstep(26.,44.,dbz);
        d+=cloudy*0.35*(0.4+n)+rain*0.022*(0.6+0.8*n)+core*(1.8+8.*smoothstep(44.,58.,dbz));
      }
    }
    return d;
  }
  float hT=(p.y-uStormBase)/(uStorm.y-uStormBase);
  if(hT>0.&&hT<1.05){
    vec2 dx=p.xz-uStorm.xz; float rr=length(dx);
    float wob=fbm3l(vec3(p.x,p.y*0.5,p.z)*0.00035)*0.7;
    float spread=1.+0.6*smoothstep(0.72,1.,hT);
    float r=rr/(uStormR*2.5*(0.75+wob)*spread);
    float sh=(1.-smoothstep(0.7,1.05,r))*smoothstep(0.,0.03,hT)*(1.-smoothstep(0.9,1.03,hT));
    if(sh>0.001){ float n=fbm3(p*0.00045+vec3(0.,-uTime*0.012,0.)); float core=1.-smoothstep(0.,0.55,r); d+=sh*max(0.,n*1.5-0.3)*(4.5+8.*core); }
  }
  return d;
}
vec4 marchClouds(vec3 ro, vec3 rd, float tmax, float dith){
  float y0=min(uCloudBase,uStormBase), y1=max(uCloudTop,uStorm.y);
  float t0,t1;
  if(abs(rd.y)<1e-5){ if(ro.y<y0||ro.y>y1) return vec4(0,0,0,1); t0=0.; t1=tmax; }
  else { float ta=(y0-ro.y)/rd.y, tb=(y1-ro.y)/rd.y; t0=max(0.,min(ta,tb)); t1=min(tmax,max(ta,tb)); }
  if(t1<=t0) return vec4(0,0,0,1);
  t1=min(t1,t0+70000.);
  int N=int(40.*uQual);
  vec3 acc=vec3(0.); float T=1.;
  float sunUp=clamp(uSun.y,0.,1.);
  vec3 sunCol=vec3(1.,0.95,0.86)*2.4; vec3 ambTop=vec3(0.55,0.62,0.80); vec3 ambBot=vec3(0.18,0.19,0.24);
  const float sig=0.009;
  for(int i=0;i<80;i++){ if(i>=N) break;
    float f0=(float(i)+0.35*dith)/float(N), f1=(float(i)+1.)/float(N);
    float ta=t0+(t1-t0)*f0*f0, tb=t0+(t1-t0)*f1*f1; float dsl=max(tb-ta,2.);
    vec3 p=ro+rd*ta;
    float d=cloudDensity(p);
    if(d>0.002){
      float d1=cloudDensity(p+uSun*300.), d2=cloudDensity(p+uSun*900.);
      float Ls=exp(-sig*(d1*300.+d2*500.));
      float hf=clamp((p.y-y0)/(y1-y0),0.,1.);
      float coreDark=1.-0.8*smoothstep(0.5,3.0,d);
      vec3 amb=mix(ambBot,ambTop,hf)*coreDark;
      vec3 col=sunCol*Ls*sunUp*coreDark+amb*(0.6+0.4*exp(-d*0.6));
      col+=uFlash*vec3(0.9,0.9,1.1)*2.5*exp(-ta/4000.);
      float a=1.-exp(-sig*d*dsl);
      acc+=T*a*col; T*=(1.-a);
      if(T<0.015) break;
    }
  }
  return vec4(acc,T);
}

// ---------------- Learjet 60 SDF (model frame: x fwd, y right, z up) ----------------
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h)-r; }
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2){
  vec3 ba=b-a; float l2=dot(ba,ba), rr=r1-r2, a2=l2-rr*rr, il2=1./l2;
  vec3 pa=p-a; float y=dot(pa,ba), z=y-l2; vec3 pz=pa*l2-ba*y; float x2=dot(pz,pz); float y2=y*y*l2, z2=z*z*l2;
  float k=sign(rr)*rr*rr*x2;
  if(sign(z)*a2*z2>k) return sqrt(x2+z2)*il2-r2;
  if(sign(y)*a2*y2<k) return sqrt(x2+y2)*il2-r1;
  return (sqrt(x2*a2*il2)+y*rr)*il2-r1; }
float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.); }
float smin(float a,float b,float k){ float h=clamp(0.5+0.5*(b-a)/k,0.,1.); return mix(b,a,h)-k*h*(1.-h); }
vec2 sdJet(vec3 p, int stabGone){
  float fus=sdRoundCone(p,vec3(5.2,0,0),vec3(8.9,0,0.15),0.92,0.10);
  fus=min(fus,sdCapsule(p,vec3(-6.5,0,0),vec3(5.2,0,0),0.92));
  fus=smin(fus,sdRoundCone(p,vec3(-6.5,0,0),vec3(-10.9,0,0.8),0.9,0.2),0.5);
  vec3 pw=p; pw.y=abs(pw.y); float yw=pw.y; float s=clamp(yw/6.7,0.,1.);
  float xle=-0.4-yw*0.26; float chord=mix(3.8,1.3,s); float th=mix(0.26,0.07,s); float zw=-0.55+yw*0.045;
  float wing=sdBox(vec3(pw.x-(xle-chord*0.5),yw-3.35,pw.z-zw),vec3(chord*0.5,3.35,th*0.5))-0.03;
  float wl=sdBox(vec3(pw.x-(xle-0.55)+0.35*(pw.z-zw),yw-6.72,pw.z-zw-0.62),vec3(0.55,0.05,0.62));
  wing=min(wing,wl);
  float eng=sdCapsule(pw,vec3(-5.3,1.55,0.55),vec3(-2.3,1.55,0.55),0.58);
  float pyl=sdBox(vec3(pw.x+3.9,pw.y-1.15,pw.z-0.45),vec3(0.9,0.42,0.12));
  float zf=clamp(p.z,0.,3.0); float xf=-7.9-zf*0.55; float cf=mix(2.6,1.3,zf/3.0);
  float fin=sdBox(vec3(p.x-(xf-cf*0.5),p.y,p.z-1.5),vec3(cf*0.5,0.07,1.5))-0.02;
  float ys=abs(p.y); float xs=-9.6-ys*0.2; float cs=mix(1.6,0.9,clamp(ys/3.1,0.,1.));
  float stab=sdBox(vec3(p.x-(xs-cs*0.5),ys-1.55,p.z-3.05),vec3(cs*0.5,1.55,0.05))-0.02;
  float d=fus; float id=0.;
  if(wing<d){d=wing;id=1.;} if(eng<d){d=eng;id=2.;} if(pyl<d){d=pyl;id=2.;} if(fin<d){d=fin;id=1.;}
  if(stabGone==0 && stab<d){d=stab;id=1.;}
  return vec2(d,id);
}
vec3 jetNormal(vec3 p, int sg){ vec2 e=vec2(0.02,0.); return normalize(vec3(sdJet(p+e.xyy,sg).x-sdJet(p-e.xyy,sg).x, sdJet(p+e.yxy,sg).x-sdJet(p-e.yxy,sg).x, sdJet(p+e.yyx,sg).x-sdJet(p-e.yyx,sg).x)); }
// returns t or -1; writes color
float traceJet(vec3 ro, vec3 rd, vec3 pos, mat3 rot, int sg, vec3 tint, float ghost, out vec3 col){
  vec3 rom=transpose(rot)*(ro-pos); vec3 rdm=transpose(rot)*rd;
  float b=dot(rom,rdm); float c=dot(rom,rom)-14.*14.; float h=b*b-c; if(h<0.) return -1.;
  float t=max(0.,-b-sqrt(h)); float tEnd=-b+sqrt(h);
  for(int i=0;i<90;i++){ vec3 p=rom+rdm*t; vec2 d=sdJet(p,sg); if(d.x<0.01){
      vec3 n=jetNormal(p,sg); vec3 nw=rot*n;
      vec3 base=vec3(0.92);
      if(d.y<0.5){ if(abs(p.z-0.05)<0.22&&p.x<5.3) base=vec3(0.08,0.18,0.5); if(p.x>5.3&&p.x<6.9&&p.z>0.25) base=vec3(0.05,0.07,0.1); if(p.x>-5.5&&p.x<4.5&&abs(p.z-0.35)<0.16&&mod(p.x+0.4,1.0)<0.45) base=vec3(0.08); }
      else if(d.y>1.5) base=vec3(0.55,0.56,0.58);
      base=mix(base,tint,ghost);
      // Under the storm the sun is blocked: mostly sky-ambient from above, darker underside -> silhouette against the overcast
      float open=uUseNex==1?0.2:1.0;
      float dif=max(dot(nw,uSun),0.)*open; vec3 r=reflect(rd,nw); float sp=pow(max(dot(r,uSun),0.),40.)*open;
      float amb=0.18+0.32*max(nw.y,0.);
      col=base*(amb+0.9*dif)+vec3(1.)*sp*0.5+uFlash*0.6;
      return t; }
    t+=d.x*0.9; if(t>tEnd) break; }
  return -1.;
}

void main(){
  float aspect=uRes.x/uRes.y;
  vec3 ro=uCamPos; vec3 rd=normalize(uCam*vec3(vUv.x*uTanFov*aspect, vUv.y*uTanFov, 1.));
  float dith=hash2(gl_FragCoord.xy+fract(uTime)*17.);
  float tG=rd.y<-1e-5 ? -ro.y/rd.y : 1e9;
  vec3 col;
  vec3 haze=mix(vec3(0.62,0.68,0.76),vec3(0.75,0.78,0.82),0.5);
  if(tG<1e8){ vec3 p=ro+rd*tG; col=groundCol(p,tG,rd); float fog=1.-exp(-tG/32000.); col=mix(col,haze,fog); }
  else { col=skyCol(rd); }
  float tScene=tG;
  if(uExt==1){ vec3 jc; float tj=traceJet(ro,rd,uAcPos,uAcRot,uStabGone,vec3(1.),0.,jc); if(tj>0.&&tj<tScene){ col=jc; tScene=tj; } }
  if(uGhost==1){ vec3 gc; float tg=traceJet(ro,rd,uGhPos,uGhRot,0,vec3(1.,0.2,0.8),0.7,gc); if(tg>0.&&tg<tScene){ col=mix(col,gc,0.55); tScene=tg; } }
  vec4 cl=marchClouds(ro,rd,min(tScene,90000.),dith);
  col=col*cl.a+cl.rgb;
  col+=uFlash*vec3(0.5,0.5,0.6)*(1.-cl.a)*0.5;
  col=1.-exp(-col*1.05);
  col=pow(col,vec3(1./2.2));
  o=vec4(col,1.);
}`;

const VS_LINE = `#version 300 es
in vec3 aPos; uniform mat4 uVP; out float vD; void main(){ vec4 c=uVP*vec4(aPos,1.); gl_Position=c; vD=c.w; }`;
const FS_LINE = `#version 300 es
precision highp float; in float vD; uniform vec4 uColor; out vec4 o; void main(){ o=vec4(uColor.rgb, uColor.a*clamp(1.-vD/60000.,0.15,1.)); }`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram(); gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 not available');
    this.scene = program(gl, VS_QUAD, FS_SCENE);
    this.line = program(gl, VS_LINE, FS_LINE);
    this.quad = gl.createVertexArray(); gl.bindVertexArray(this.quad);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.u = {}; for (const n of ['uRes', 'uTime', 'uCamPos', 'uCam', 'uTanFov', 'uSun', 'uAcPos', 'uAcRot', 'uExt', 'uStabGone', 'uGhPos', 'uGhRot', 'uGhost', 'uStorm', 'uStormR', 'uStormBase', 'uFlash', 'uQual', 'uCloudBase', 'uCloudTop', 'uNexA', 'uNexB', 'uNexMix', 'uNexO', 'uNexS', 'uUseNex']) this.u[n] = gl.getUniformLocation(this.scene, n);
    this.nexTex = null;
    this.ul = { uVP: gl.getUniformLocation(this.line, 'uVP'), uColor: gl.getUniformLocation(this.line, 'uColor') };
    this.lineVao = gl.createVertexArray(); gl.bindVertexArray(this.lineVao);
    this.lineBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.scale = 0.5; this.quality = 1.0;
  }
  // Upload two gridded reflectivity volumes as R8 3D textures (layout [north][up][east] -> depth=z, height=y, width=x)
  setNexrad(fa, fb) {
    const gl = this.gl; const mk = (f) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, f.nx, f.ny, f.nz, 0, gl.RED, gl.UNSIGNED_BYTE, f.data);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      return t; };
    this.nexTex = [mk(fa), mk(fb)]; this.nexO = [fa.x0, fa.y0, fa.z0]; this.nexS = [fa.nx * fa.d, fa.ny * fa.d, fa.nz * fa.d];
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr * this.scale), h = Math.floor(window.innerHeight * dpr * this.scale);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }
  // Build view-projection for line drawing. cam: {pos:[x,y,z], right, up, fwd}
  viewProj(cam, aspect, fov) {
    const { right: r, up: u, fwd: f, pos: p } = cam;
    // View: rows right, up, -fwd (looking down -z in clip conventions, we use +fwd so negate)
    const view = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0,
      -(r[0]*p[0] + r[1]*p[1] + r[2]*p[2]), -(u[0]*p[0] + u[1]*p[1] + u[2]*p[2]), (f[0]*p[0] + f[1]*p[1] + f[2]*p[2]), 1];
    const n = 2, fa = 300000, t = 1 / Math.tan(fov / 2);
    const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0];
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += proj[k*4 + j] * view[i*4 + k]; out[i*4 + j] = s; }
    return out;
  }
  render(S) {
    const gl = this.gl; this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.scene); gl.bindVertexArray(this.quad);
    const u = this.u, c = S.cam;
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, S.time);
    gl.uniform3fv(u.uCamPos, c.pos);
    gl.uniformMatrix3fv(u.uCam, false, [c.right[0], c.right[1], c.right[2], c.up[0], c.up[1], c.up[2], c.fwd[0], c.fwd[1], c.fwd[2]]);
    gl.uniform1f(u.uTanFov, Math.tan(S.fov / 2));
    gl.uniform3fv(u.uSun, S.sun);
    gl.uniform3fv(u.uAcPos, S.ac.pos);
    const a = S.ac; gl.uniformMatrix3fv(u.uAcRot, false, [a.fwd[0], a.fwd[1], a.fwd[2], a.right[0], a.right[1], a.right[2], a.up[0], a.up[1], a.up[2]]);
    gl.uniform1i(u.uExt, S.ext ? 1 : 0); gl.uniform1i(u.uStabGone, S.stabGone ? 1 : 0);
    const g = S.ghost; gl.uniform3fv(u.uGhPos, g.pos); gl.uniformMatrix3fv(u.uGhRot, false, [g.fwd[0], g.fwd[1], g.fwd[2], g.right[0], g.right[1], g.right[2], g.up[0], g.up[1], g.up[2]]);
    gl.uniform1i(u.uGhost, S.showGhost ? 1 : 0);
    gl.uniform3fv(u.uStorm, S.storm.pos); gl.uniform1f(u.uStormR, S.storm.r); gl.uniform1f(u.uStormBase, S.storm.base);
    gl.uniform1f(u.uFlash, S.flash); gl.uniform1f(u.uQual, this.quality);
    gl.uniform1f(u.uCloudBase, S.cloudBase); gl.uniform1f(u.uCloudTop, S.cloudTop);
    const useNex = this.nexTex && S.useNex ? 1 : 0; gl.uniform1i(u.uUseNex, useNex);
    if (this.nexTex) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, this.nexTex[0]); gl.uniform1i(u.uNexA, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, this.nexTex[1]); gl.uniform1i(u.uNexB, 1);
      gl.uniform1f(u.uNexMix, S.nexMix); gl.uniform3fv(u.uNexO, this.nexO); gl.uniform3fv(u.uNexS, this.nexS);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // lines
    if (S.lines && S.lines.length) {
      gl.useProgram(this.line); gl.bindVertexArray(this.lineVao);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const vp = this.viewProj(c, this.canvas.width / this.canvas.height, S.fov);
      gl.uniformMatrix4fv(this.ul.uVP, false, vp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      for (const L of S.lines) {
        if (L.data.length < 6) continue;
        gl.bufferData(gl.ARRAY_BUFFER, L.data, gl.DYNAMIC_DRAW);
        gl.uniform4fv(this.ul.uColor, L.color);
        gl.drawArrays(L.strip ? gl.LINE_STRIP : gl.LINES, 0, L.data.length / 3);
      }
    }
  }
}
