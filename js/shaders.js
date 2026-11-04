// GLSL for the renderer (js/render.js).
//   Atmosphere: Bruneton/Hillaire-style precomputed transmittance + multiple-scattering LUTs, a per-frame sky-view LUT,
//   and per-pixel aerial perspective with cloud shadowing (god rays under the storm).
//   Clouds: volumetric, shaped by the KAMX NEXRAD volumes (or a procedural cell) and a cumulus layer, eroded with
//   baked tileable Perlin-Worley / Worley noise, lit with a sun light-march, multiple-scattering octaves, a dual-lobe
//   phase function, sky/ground ambient and lightning.
//   Post: temporal anti-aliasing / upsampling, physically based bloom, eye adaptation, ACES filmic tonemap.
// Units: world metres (x east, y up, z north, origin KPBI); atmosphere functions use km in a planet-centred frame.

export const VS_QUAD = `#version 300 es
in vec2 aPos; out vec2 vUv; void main(){ vUv=aPos; gl_Position=vec4(aPos,0.,1.); }`;

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler3D;
`;

// ---------------------------------------------------------------------------------------------------------------
const ATMO = `
const float PI=3.14159265359;
const float RG=6360., RT=6460.;                       // km: ground, top of atmosphere
const vec3 BR=vec3(5.802,13.558,33.1)*1e-3;          // Rayleigh scattering /km
const vec3 BO=vec3(0.650,1.881,0.085)*1e-3;          // ozone absorption /km
uniform float uMie;                                   // aerosol multiplier (humid maritime haze > 1)
uniform sampler2D uTrans, uMS;
float mieS(){ return 3.996e-3*uMie; }
float mieE(){ return 8.396e-3*uMie; }
vec3 dens(float h){ return vec3(exp(-h/8.), exp(-h/1.2), max(0.,1.-abs(h-25.)/15.)); }
vec3 extAt(float h){ vec3 d=dens(h); return BR*d.x+vec3(mieE()*d.y)+BO*d.z; }
// ray / sphere about the planet centre; r = |P|, returns (near, far) or (-1,-2) on miss
vec2 rsph(vec3 P, vec3 rd, float R){ float r=length(P); float b=dot(P,rd); float c=(r-R)*(r+R); float h=b*b-c; if(h<0.) return vec2(-1.,-2.); h=sqrt(h);
  float q=-b-sign(b)*h; float t0=c/q, t1=q; if(abs(q)<1e-9){ t0=-b; t1=-b; } return t0<t1?vec2(t0,t1):vec2(t1,t0); }
vec2 transUV(float r,float mu){ float H=sqrt(RT*RT-RG*RG); float rho=sqrt(max(r*r-RG*RG,0.)); float disc=r*r*(mu*mu-1.)+RT*RT;
  float d=max(0.,-r*mu+sqrt(max(disc,0.))); float dmin=RT-r, dmax=rho+H; vec2 uv=vec2((d-dmin)/max(dmax-dmin,1e-4), rho/H);
  return (uv*vec2(255.,63.)+0.5)/vec2(256.,64.); }
vec3 transmittance(float r,float mu){ return texture(uTrans, transUV(r,mu)).rgb; }
float earthShadow(float r,float mu){ float muH=-sqrt(max(0.,1.-RG*RG/(r*r))); return smoothstep(muH-0.004,muH+0.004,mu); }
vec3 msAt(float r,float mus){ vec2 uv=vec2(mus*0.5+0.5, clamp((r-RG)/(RT-RG),0.,1.)); return texture(uMS,(uv*31.+0.5)/32.).rgb; }
float phaseR(float c){ return 3./(16.*PI)*(1.+c*c); }
float phaseHG(float c,float g){ float g2=g*g; return (1.-g2)/(4.*PI*pow(max(1.+g2-2.*g*c,1e-4),1.5)); }
float phaseCS(float c,float g){ float g2=g*g; return 3./(8.*PI)*(1.-g2)*(1.+c*c)/((2.+g2)*pow(max(1.+g2-2.*g*c,1e-4),1.5)); }
`;

// ---------------------------------------------------------------------------------------------------------------
export const FS_TRANS = HEAD + `out vec4 o;` + ATMO + `
void main(){ vec2 uv=(gl_FragCoord.xy-0.5)/vec2(255.,63.);
  float H=sqrt(RT*RT-RG*RG); float rho=H*uv.y; float r=sqrt(rho*rho+RG*RG); float dmin=RT-r, dmax=rho+H; float d=dmin+uv.x*(dmax-dmin);
  float mu=d<=0.?1.:(H*H-rho*rho-d*d)/(2.*r*d); mu=clamp(mu,-1.,1.);
  vec3 P=vec3(0,r,0), rd=vec3(sqrt(1.-mu*mu),mu,0); float tmax=rsph(P,rd,RT).y;
  vec3 od=vec3(0); const int N=48; float dt=tmax/float(N);
  for(int i=0;i<N;i++){ vec3 p=P+rd*(float(i)+0.5)*dt; od+=extAt(length(p)-RG)*dt; }
  o=vec4(exp(-od),1.); }`;

export const FS_MS = HEAD + `out vec4 o;` + ATMO + `
void main(){ vec2 uv=(gl_FragCoord.xy-0.5)/31.; float mus=uv.x*2.-1.; float r=RG+max(uv.y,0.0015)*(RT-RG);
  vec3 sun=vec3(sqrt(max(0.,1.-mus*mus)),mus,0.); vec3 P=vec3(0,r,0);
  vec3 L2=vec3(0), F=vec3(0); const float ALB=0.3;
  for(int i=0;i<8;i++) for(int j=0;j<8;j++){
    float th=2.*PI*(float(i)+0.5)/8., ph=acos(1.-2.*(float(j)+0.5)/8.);
    vec3 rd=vec3(cos(th)*sin(ph), cos(ph), sin(th)*sin(ph));
    vec2 g=rsph(P,rd,RG); bool hitG=g.x>0.; float tmax=hitG?g.x:rsph(P,rd,RT).y;
    vec3 T=vec3(1), L=vec3(0), f=vec3(0); const int N=20; float dt=tmax/float(N);
    for(int k=0;k<N;k++){ vec3 p=P+rd*(float(k)+0.5)*dt; float rr=length(p), h=rr-RG; vec3 d=dens(h);
      vec3 sc=BR*d.x+vec3(mieS()*d.y); vec3 e=extAt(h); float mu=dot(p,sun)/rr;
      vec3 Ts=transmittance(rr,mu)*earthShadow(rr,mu);
      vec3 ex=exp(-e*dt); vec3 S=sc*Ts/(4.*PI);
      L+=T*(S-S*ex)/e; f+=T*(sc-sc*ex)/e; T*=ex; }
    if(hitG){ vec3 p=P+rd*tmax; vec3 n=normalize(p); float mu=dot(n,sun); L+=T*transmittance(RG,mu)*max(mu,0.)*ALB/PI; }
    L2+=L/64.; F+=f/64.; }
  o=vec4(L2/(1.-F),1.); }`;

// Sky-view LUT: radiance seen from the camera altitude, parameterised by azimuth from the sun and a view-zenith
// mapping that packs resolution around the horizon (Hillaire 2020).
export const FS_SKYVIEW = HEAD + `out vec4 o; uniform float uCamR; uniform float uSunMu; uniform float uSunE;` + ATMO + `
void main(){ vec2 uv=(gl_FragCoord.xy-0.5)/vec2(191.,107.); float r=max(uCamR,RG+0.005);
  float Vh=sqrt(r*r-RG*RG); float beta=acos(Vh/r); float Z=PI-beta; float vz;
  if(uv.y<0.5){ float c=1.-2.*uv.y; c=1.-c*c; vz=Z*c; } else { float c=uv.y*2.-1.; vz=Z+beta*c*c; }
  float lon=uv.x*uv.x*PI;
  vec3 rd=vec3(sin(vz)*cos(lon), cos(vz), sin(vz)*sin(lon)); vec3 sun=vec3(sqrt(max(0.,1.-uSunMu*uSunMu)),uSunMu,0.);
  vec3 P=vec3(0,r,0); vec2 g=rsph(P,rd,RG); vec2 a=rsph(P,rd,RT); float tmax=g.x>0.?g.x:a.y;
  float cs=dot(rd,sun); float pr=phaseR(cs), pm=phaseCS(cs,0.8);
  vec3 T=vec3(1), L=vec3(0); const int N=36; float tp=0.;
  for(int k=0;k<N;k++){ float t=tmax*pow((float(k)+0.5)/float(N),1.6); float dt=t-tp; tp=t; vec3 p=P+rd*t; float rr=length(p), h=rr-RG; vec3 d=dens(h);
    vec3 sR=BR*d.x; float sM=mieS()*d.y; vec3 e=extAt(h); float mu=dot(p,sun)/rr;
    vec3 Ts=transmittance(rr,mu)*earthShadow(rr,mu);
    vec3 S=(sR*pr+sM*pm)*Ts+(sR+sM)*msAt(rr,mu); vec3 ex=exp(-e*dt);
    L+=T*(S-S*ex)/e; T*=ex; }
  o=vec4(L*uSunE,1.); }`;

// ---------------------------------------------------------------------------------------------------------------
// Tileable noise bake (one 3D-texture slice per draw)
const NOISE_LIB = `
vec3 h33(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float worley(vec3 p,float per){ vec3 id=floor(p), f=fract(p); float md=1.;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){ vec3 o=vec3(x,y,z); vec3 c=mod(id+o,per); vec3 d=o+h33(c)-f; md=min(md,dot(d,d)); }
  return 1.-sqrt(md); }
vec3 grad(vec3 c,float per){ return normalize(h33(mod(c,per))*2.-1.); }
float perlin(vec3 p,float per){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*f*(f*(f*6.-15.)+10.);
  float n000=dot(grad(i,per),f), n100=dot(grad(i+vec3(1,0,0),per),f-vec3(1,0,0)), n010=dot(grad(i+vec3(0,1,0),per),f-vec3(0,1,0)), n110=dot(grad(i+vec3(1,1,0),per),f-vec3(1,1,0));
  float n001=dot(grad(i+vec3(0,0,1),per),f-vec3(0,0,1)), n101=dot(grad(i+vec3(1,0,1),per),f-vec3(1,0,1)), n011=dot(grad(i+vec3(0,1,1),per),f-vec3(0,1,1)), n111=dot(grad(i+vec3(1,1,1),per),f-vec3(1,1,1));
  return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z)*0.5+0.5; }
float wfbm(vec3 p,float fr){ return worley(p*fr,fr)*0.625+worley(p*fr*2.,fr*2.)*0.25+worley(p*fr*4.,fr*4.)*0.125; }
float pfbm(vec3 p,float fr){ float s=0., a=0.5; for(int i=0;i<5;i++){ s+=a*perlin(p*fr,fr); fr*=2.; a*=0.5; } return s/0.96875; }
float remap(float x,float a,float b,float c,float d){ return c+(x-a)*(d-c)/(b-a); }
`;
export const FS_NOISE = HEAD + `out vec4 o; uniform float uZ; uniform float uSize; uniform int uKind;` + NOISE_LIB + `
void main(){ vec3 p=vec3(gl_FragCoord.xy, uZ+0.5)/uSize;
  if(uKind==0){
    float pf=pfbm(p,4.); pf=abs(pf*2.-1.); pf=1.-pf;                  // billowy Perlin
    float w1=wfbm(p,4.), w2=wfbm(p,8.), w3=wfbm(p,16.);
    float pw=clamp(remap(pf,0.,1.,w1,1.),0.,1.);
    o=vec4(pw,w1,w2,w3);
  } else {
    o=vec4(wfbm(p,2.),wfbm(p,4.),wfbm(p,8.),1.);
  } }`;

// ---------------------------------------------------------------------------------------------------------------
// Cloud field shared by the scene and the cloud-shadow pass
const CLOUDS = `
uniform highp sampler3D uNoise, uDetail;
uniform highp sampler3D uNexA, uNexB; uniform float uNexMix; uniform vec3 uNexO, uNexS; uniform int uUseNex;
uniform vec3 uStorm; uniform float uStormR, uStormBase, uStormCB;
uniform vec3 uLayer; uniform float uLayerSig; uniform vec2 uWind; uniform float uTime;
uniform vec3 uSun;
uniform sampler2D uGoes; uniform int uUseGoes; uniform vec4 uGoesB; uniform float uGoesMix; uniform sampler2D uGoes2;
float gLod=0.; float gDetail=1.; float gNearT=1e9; float gCu=0.;
vec4 NZ(vec3 p){ return textureLod(uNoise,p,gLod); }
vec4 DT(vec3 p){ return textureLod(uDetail,p,gLod); }
float remap(float x,float a,float b,float c,float d){ return c+(x-a)*(d-c)/(b-a); }
float sat(float x){ return clamp(x,0.,1.); }
// altitude above the spherical earth for a world point (planet centre at (0,-R,0))
float altOf(vec3 p){ return p.y-dot(p.xz,p.xz)/12720000.; }
// extinction (1/m). lod 0: full detail, 1: no detail erosion (light march / shadows)
// Real-weather model (useGoes): METAR low cumulus layer + an MCS cloud mass from the METAR overcast base up to the GOES-19
// cloud-top surface (thickness from visible reflectance), with NEXRAD convective cores and rain shafts inside it.
uniform float uDeckBase;
float cloudSigma(vec3 p, float h, int lod){
  float sig=0.; gCu=0.;
  vec2 adv=p.xz-uWind*uTime;
  // ---- low cumulus layer ----
  if(h>uLayer.x && h<uLayer.y){
    float hf=(h-uLayer.x)/(uLayer.y-uLayer.x);
    float cov=uLayer.z;
    vec4 wn=NZ(vec3(adv.x,0.,adv.y)/42000.);
    cov*=sat(remap(wn.r*0.6+wn.g*0.4,0.42,0.78,0.,1.));
    float prof=smoothstep(0.,0.08,hf)*smoothstep(1.,0.55,hf)*(0.75+0.5*hf);
    vec4 n=NZ(vec3(adv.x,h,adv.y)/5200.);
    float fb=n.g*0.625+n.b*0.25+n.a*0.125;
    float shape=sat((n.r*0.6+fb*0.4-0.18)*1.45);
    // Nubis-style: soft base field -> eroded by Worley detail across its whole range -> sharpened (crisp cauliflower edges)
    float c=sat(remap(shape*prof,1.-cov,1.,0.,1.));
    if(lod==0 && c>0. && gDetail>0.){ vec3 dn=DT(vec3(adv.x,h*1.3,adv.y)/900.).rgb; float df=sat((dn.r*0.625+dn.g*0.25+dn.b*0.125-0.5)*2.6+0.5);
      c=sat(remap(c, mix(df,1.-df,sat(hf*3.))*0.6*gDetail, 1., 0., 1.));
      if(gLod<1.5 && c>0.){ vec3 fn=DT(vec3(adv.x,h*1.2,adv.y)/260.).rgb; c=sat(remap(c,sat((fn.r*0.6+fn.g*0.4-0.5)*2.6+0.5)*0.3,1.,0.,1.)); } }
    c=sat(c*3.);
    sig+=c*uLayerSig; gCu=c*uLayerSig;
  }
  // ---- MCS deck: METAR overcast base -> GOES cloud-top height ----
  float top=-1.;
  if(uUseGoes==1 && h>uDeckBase-300.){          // below the deck base nothing here can contribute: skip the fetches
    vec2 gu=clamp((p.xz-uGoesB.xy)/uGoesB.zw,0.002,0.998);
    {
      vec4 g=mix(textureLod(uGoes,vec2(gu.x,1.-gu.y),0.),textureLod(uGoes2,vec2(gu.x,1.-gu.y),0.),uGoesMix);
      top=g.g*25500.;
      float edge=1.;
      if(g.a>0.5 && top>uDeckBase+400. && h>uDeckBase-300. && h<top+1600.){
        float thick=smoothstep(0.3,0.75,g.r);
        float base=mix(max(top-2500.,uDeckBase),uDeckBase,thick);
        vec4 n=NZ(vec3(adv.x,h*0.5,adv.y)/9000.);
        float fb=n.g*0.625+n.b*0.25+n.a*0.125;
        vec4 m=NZ(vec3(adv.x,h*0.7,adv.y)/2600.+vec3(0.37,0.11,0.73));
        float bil=0.; if(h>top-2500.){ vec4 q=DT(vec3(adv.x,h*0.5,adv.y)/1400.); bil=(q.r*0.6+q.g*0.4-0.5)*700.; }
        float topP=top+(n.r*0.65+fb*0.35-0.55)*1900.+(m.r*0.7+m.g*0.3-0.55)*1400.+bil;
        float baseP=base+(fb-0.5)*600.;
        float d=smoothstep(baseP,baseP+600.,h)*(1.-smoothstep(topP-250.,topP,h))*edge;
        if(lod==0 && d>0. && d<0.999 && gDetail>0.){ vec3 dn=DT(vec3(adv.x,h,adv.y)/1300.).rgb; float df=dn.r*0.625+dn.g*0.25+dn.b*0.125; d=sat(remap(d,df*0.45*gDetail,1.,0.,1.)); }
        float var=0.45+1.1*sat(n.r*1.2-0.1);           // in-cloud density variation (light and dark patches in IMC)
        if(gNearT<1200.){ vec3 fw=DT(vec3(adv.x,h*1.8,adv.y)/150.).rgb, fw2=DT(vec3(adv.x,h*1.4,adv.y)/420.+0.37).rgb;
          float f=sat((fw.r*0.5+fw2.g*0.5-0.5)*3.2+0.5);
          var*=mix(1.,0.08+2.2*f*f,1.-smoothstep(300.,1200.,gNearT)); }   // filaments streaming past the aircraft
        sig+=d*mix(0.0012,0.0045,thick)*var*(1.+1.5*smoothstep(top-2500.,top,h));
      }
    }
  }
  // ---- NEXRAD: convective cores and rain ----
  if(uUseNex==1){
    vec3 uvw=(vec3(p.x,h,p.z)-uNexO)/uNexS;
    if(all(greaterThan(uvw,vec3(0.003)))&&all(lessThan(uvw,vec3(0.997)))){
      float enc=mix(texture(uNexA,uvw).r,texture(uNexB,uvw).r,uNexMix)*255.;
      if(enc>1.5){
        float dbz=enc*0.25-10.;
        vec4 n=NZ(vec3(adv.x,h-uTime*3.,adv.y)/7000.);
        float ex=min(min(uvw.x,1.-uvw.x)*uNexS.x, min(uvw.z,1.-uvw.z)*uNexS.z);
        float ef=smoothstep(0.,1.,(ex+(n.g-0.5)*9000.)/9000.);
        float cov=smoothstep(2.,56.,enc)*ef;
        if(top>0.) cov*=1.-smoothstep(top-700.,top+200.,h);      // radar beam spread: no echo above the satellite cloud top
        if(h>uStormCB){
          float fb=n.g*0.625+n.b*0.25+n.a*0.125; float base=remap(n.r,-(1.-fb),1.,0.,1.);
          float d=sat((cov-(1.-base)*0.55)/0.45);
          if(lod==0 && d>0. && d<0.999 && gDetail>0.){ vec3 dn=DT(vec3(adv.x,h-uTime*4.,adv.y)/1100.).rgb; float df=dn.r*0.625+dn.g*0.25+dn.b*0.125; d=sat(remap(d,df*0.3*gDetail,1.,0.,1.)); }
          float k=uUseGoes==1 ? 0.04*pow(smoothstep(14.,48.,dbz),1.3) : mix(0.004,0.045,smoothstep(8.,46.,dbz));
          sig+=d*k*smoothstep(uStormCB,uStormCB+300.,h);
        }
        if(h<uStormCB+400.){   // rain shafts: streaky, light extinction rising with reflectivity
          float sn=NZ(vec3(adv.x,h*0.2-uTime*8.,adv.y)/2500.).g;
          float rain=6e-4*pow(10.,(dbz-30.)/28.)*smoothstep(10.,22.,dbz)*(0.5+sn)*ef;
          sig+=rain*(1.-smoothstep(uStormCB,uStormCB+400.,h));
        }
      }
    }
  } else {
    float hT=(h-uStormBase)/(uStorm.y-uStormBase);
    if(hT>0.&&hT<1.08){
      float an=smoothstep(0.72,1.,hT);
      vec2 shear=normalize(vec2(1.,0.35))*an*an*9000.;          // anvil blown downwind at the top
      vec2 dx=p.xz-uStorm.xz-shear; float rr=length(dx);
      float w1=smoothstep(0.25,0.75,textureLod(uNoise,vec3(p.x/9000.,h/6000.,p.z/9000.),1.).g), w2=smoothstep(0.2,0.8,textureLod(uNoise,vec3(p.x/3000.,h/2600.,p.z/3000.)+0.31,0.).b);
      float spread=1.+2.2*an;
      float r=rr/(uStormR*2.6*(0.35+0.8*w1+0.45*w2)*spread);
      float sh=(1.-smoothstep(0.55,1.05,r))*smoothstep(0.,0.03,hT)*(1.-smoothstep(0.92,1.05,hT));
      if(sh>0.001){ vec4 n=NZ(vec3(adv.x,h-uTime*6.,adv.y)/6000.); float fb=n.g*0.625+n.b*0.25+n.a*0.125; float base=remap(n.r,-(1.-fb),1.,0.,1.);
        float d=sat(remap(base*sh,0.25,1.,0.,1.));
        if(lod==0&&d>0.&&gDetail>0.){ vec3 dn=DT(vec3(adv.x,h,adv.y)/1000.).rgb; d=sat(remap(d,(dn.r*0.6+dn.g*0.3+dn.b*0.1)*0.3*gDetail,1.,0.,1.)); }
        float core=1.-smoothstep(0.,0.5,r); sig+=d*(0.01+0.04*core); }
    }
  }
  return sig;
}
`;

// Cloud-shadow map: for each ground column, optical depth along the sun ray from 0/4/8/12 km to the top.
export const FS_SHADOW = HEAD + `out vec4 o; uniform vec4 uCSO; uniform float uTop;` + CLOUDS + `
void main(){ gLod=2.; vec2 uv=gl_FragCoord.xy/1024.; vec2 g=uCSO.xy+uv*uCSO.z;
  vec3 sd=uSun/max(uSun.y,0.08);                   // step per metre of altitude
  float tau=0.; vec4 res=vec4(0); const int N=48; float dh=uTop/float(N);
  for(int i=N-1;i>=0;i--){ float h=(float(i)+0.5)*dh; vec3 p=vec3(g.x,0.,g.y)+sd*h; p.y=h;
    float hb=float(i)*dh, ht=hb+dh; float dtau=cloudSigma(p,h,1)*dh*length(sd);
    // capture tau at the 12/8/4 km levels (linear within the layer that straddles them)
    if(hb<=12000.&&ht>12000.) res.a=tau+dtau*(ht-12000.)/dh;
    if(hb<=8000.&&ht>8000.) res.b=tau+dtau*(ht-8000.)/dh;
    if(hb<=4000.&&ht>4000.) res.g=tau+dtau*(ht-4000.)/dh;
    tau+=dtau; }
  res.r=tau; o=res; }`;

// ---------------------------------------------------------------------------------------------------------------
export const FS_SCENE = HEAD + `
in vec2 vUv; layout(location=0) out vec4 oCol; layout(location=1) out vec4 oDep;
uniform vec2 uRes, uJit; uniform int uFrame;
uniform vec3 uCamPos; uniform mat3 uCam; uniform float uTanFov;
uniform float uSunE; uniform float uQual;
uniform sampler2D uSkyView, uCShadow; uniform vec4 uCSO; uniform float uFarTau;
uniform vec3 uAcPos; uniform mat3 uAcRot; uniform int uExt; uniform int uStabGone;
uniform vec3 uGhPos; uniform mat3 uGhRot; uniform int uGhost;
uniform float uFlash; uniform vec3 uFlashPos;
uniform sampler2D uGNear, uGFar, uGSite, uGDetail; uniform int uGround; uniform int uCity; uniform vec4 uGBDetail;
uniform sampler2D uCityA, uCityB; uniform vec4 uCityO; uniform vec4 uGBNear, uGBFar, uGBSite;   // cell map: origin xz, cells, cell size
vec3 gAmbTop, gAmbBot, gSunT;
` + ATMO + CLOUDS + `
// Diffuse light field below/inside cloud with optical depth tau above (toward the sun): clear-sky light attenuated,
// plus sunlight that diffuses through the cloud (neutral, ~1/(1+0.75 tau (1-g)) for g~0.85).
vec3 cloudDiffuse(float tau){ return gSunT*(uSunE*max(uSun.y,0.)/PI)*(1.-exp(-tau))/(1.+0.11*tau); }
vec3 ambientAt(float tau){ return gAmbTop*exp(-0.5*tau)+cloudDiffuse(tau); }
float ign(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715)))); }
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 x){ vec2 p=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(mix(h21(p),h21(p+vec2(1,0)),f.x),mix(h21(p+vec2(0,1)),h21(p+vec2(1,1)),f.x),f.y); }

// ---------------- sky ----------------
vec3 skyLUT(vec3 P, vec3 rd){
  float r=length(P); vec3 up=P/r; float cz=clamp(dot(rd,up),-1.,1.);
  vec3 sp=uSun-up*dot(uSun,up); vec3 rp=rd-up*cz; float ls=length(sp), lr=length(rp);
  float lon=(ls>1e-4&&lr>1e-4)?acos(clamp(dot(rp/lr,sp/ls),-1.,1.)):0.;
  float Vh=sqrt(max(r*r-RG*RG,0.)); float beta=acos(clamp(Vh/r,0.,1.)); float Z=PI-beta; float vz=acos(cz);
  float v= vz<Z ? (1.-sqrt(max(0.,1.-vz/Z)))*0.5 : (sqrt(max(0.,(vz-Z)/beta))+1.)*0.5;
  vec2 uv=vec2(sqrt(lon/PI),v); return texture(uSkyView,(uv*vec2(191.,107.)+0.5)/vec2(192.,108.)).rgb; }
vec3 sunDisk(vec3 P, vec3 rd){ float c=dot(rd,uSun); const float cs=0.99998914; // 0.267 deg
  if(c<cs) return vec3(0); float r=length(P); float mu=dot(P,uSun)/r; vec2 g=rsph(P,rd,RG); if(g.x>0.) return vec3(0);
  float x=sqrt(max(0.,1.-(1.-c)/(1.-cs))); vec3 limb=pow(vec3(x),vec3(0.42,0.5,0.62));
  return min(transmittance(r,mu)*uSunE*limb*2200.,vec3(30000.)); }

// ---------------- cloud shadow map ----------------
float shadowTau(vec3 wp){
  float h=max(altOf(wp),0.); vec2 g=wp.xz-uSun.xz*(h/max(uSun.y,0.08)); vec2 uv=(g-uCSO.xy)/uCSO.z;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))) return uFarTau*sat((13000.-h)/11000.);   // beyond the map: typical column
  vec4 s=texture(uCShadow,uv); float k=h/4000.;
  float tau= k<1.?mix(s.r,s.g,k): k<2.?mix(s.g,s.b,k-1.): k<3.?mix(s.b,s.a,k-2.): mix(s.a,0.,sat((h-12000.)/4500.));
  return tau; }

// ---------------- aerial perspective (single + multiple scattering, cloud-shadowed) ----------------
vec3 aerial(vec3 ro, vec3 rd, float distM, out vec3 Tout, int N, float dith){
  vec3 P=vec3(ro.x/1000.,RG+ro.y/1000.,ro.z/1000.); float dist=distM/1000.;
  vec2 a=rsph(P,rd,RT); dist=min(dist, max(a.y,0.));
  float cs=dot(rd,uSun); float pr=phaseR(cs), pm=phaseCS(cs,0.8);
  vec3 T=vec3(1), L=vec3(0); float tp=0.;
  for(int k=0;k<16;k++){ if(k>=N) break;
    float t=dist*pow((float(k)+dith)/float(N),1.5); float tn=dist*pow((float(k)+1.)/float(N),1.5); float dt=tn-tp; tp=tn;
    vec3 p=P+rd*t; float rr=length(p), h=rr-RG; vec3 d=dens(h); vec3 sR=BR*d.x; float sM=mieS()*d.y; vec3 e=extAt(h);
    float mu=dot(p,uSun)/rr; vec3 Ts=transmittance(rr,mu)*earthShadow(rr,mu);
    float tau=0.; if(h<17.5){ vec3 wp=ro+rd*t*1000.; tau=shadowTau(wp); } float sh=exp(-tau);
    vec3 S=((sR*pr+sM*pm)*Ts*sh+(sR+sM)*msAt(rr,mu)*exp(-0.5*tau))*uSunE+(sR+sM)*cloudDiffuse(tau)*0.6; vec3 ex=exp(-e*dt);
    L+=T*(S-S*ex)/e; T*=ex; }
  Tout=T; return L; }

// ---------------- ground ----------------
vec3 procAlbedo(vec2 en, float t, out float water){
  float e=en.x, n=en.y;
  float coastX=9000.+700.*sin(n*0.00011+1.)+300.*sin(n*0.00047+0.5);
  float lake=length(vec2(e+56000.,n-26000.))-24000.;
  vec2 g=en/1609.34; vec2 cell=floor(g), f=fract(g); float h1=h21(cell);
  float urb=smoothstep(-26000.,4000.,e)*(1.-smoothstep(coastX-2200.,coastX-1900.,e))+smoothstep(coastX-1500.,coastX-1300.,e)*0.8;
  float big=n2(en*0.00012);
  vec3 veg=mix(vec3(0.19,0.30,0.13),vec3(0.38,0.42,0.22),n2(en*0.0006)*0.7+big*0.3);
  float wet=smoothstep(-14000.,-26000.,e); veg=mix(veg,mix(vec3(0.30,0.34,0.17),vec3(0.17,0.22,0.14),n2(en*0.0009)),wet);
  float farm=smoothstep(-30000.,-40000.,e)*(1.-step(0.,-lake)); veg=mix(veg,mix(vec3(0.45,0.38,0.22),vec3(0.25,0.40,0.15),h21(floor(en/800.))),farm);
  vec2 bc=floor(en/180.); float hb=h21(bc); vec3 roof=mix(vec3(0.46,0.43,0.40),vec3(0.78,0.74,0.68),hb);
  float isUrb=step(h1*0.9+0.05,urb); vec3 col=mix(veg,mix(roof,veg,0.35*h21(bc+3.1)),isUrb);
  float rw=12.+t*0.004; float road=max(step(f.x*1609.34,rw),step(f.y*1609.34,rw))*mix(0.35,1.,urb); col=mix(col,vec3(0.52,0.52,0.50),sat(road));
  float beach=smoothstep(coastX-90.,coastX,e)*(1.-step(coastX,e)); col=mix(col,vec3(0.85,0.80,0.65),beach);
  water=max(max(step(coastX,e), step(lake,0.)), step(coastX-2100.,e)*step(e,coastX-1400.));
  return pow(col,vec3(2.2))*0.8; }
// imagery texel (rgb, alpha = water mask) and its blend weight (fades out at the image edge)
vec4 sampleG(sampler2D s, vec4 B, vec2 en, out float w){ vec2 uv=vec2((en.x-B.x)/(B.y-B.x),(B.w-en.y)/(B.w-B.z));
  vec2 ed=min(uv,1.-uv); w=sat(min(ed.x,ed.y)*40.); return texture(s,clamp(uv,0.,1.)); }
// KPBI runways painted over the imagery (FAA AC 150/5340-1 precision markings): asphalt, edge stripes, 36 m / 24 m
// centreline, threshold bars, touchdown-zone bars and aiming points. uRwy[i] = threshold (east, north), unit vector;
// uRwyD[i] = length, width. Blur grows with distance and with grazing angle (uRwyCamH = camera height above ground).
uniform vec4 uRwy[3]; uniform vec2 uRwyD[3]; uniform float uRwyCamH;
float band(float x, float a, float b, float aa){ return smoothstep(a-aa,a+aa,x)-smoothstep(b-aa,b+aa,x); }
vec3 paintRunways(vec2 en, float t, vec3 a){
  if(uRwyD[0].x<=0. || t>14000.) return a;
  float aa=max(0.1,t*0.0011), aS=aa*clamp(t/max(uRwyCamH,2.),1.,60.), fade=1.-smoothstep(4000.,12000.,t);
  for(int i=0;i<3;i++){
    vec4 r=uRwy[i]; vec2 d=uRwyD[i]; if(d.x<=0.) continue;
    vec2 u=r.zw, p=en-r.xy; float s=dot(p,u), c=dot(p,vec2(-u.y,u.x)), L=d.x, hw=d.y*0.5;
    if(s<-40. || s>L+40. || abs(c)>hw+6.) continue;
    float inside=band(s,0.,L,aS)*(1.-smoothstep(hw-aa,hw+aa,abs(c)));
    if(inside<=0.) continue;
    vec3 asph=vec3(0.13,0.135,0.14)*(0.8+0.4*n2(en*0.3))*(0.92+0.16*n2(en*0.02+5.));
    float m=band(abs(c),hw-1.2,hw-0.3,aa);                                   // edge stripes
    float ph=mod(s-120.,60.);
    if(s>120. && s<L-120.) m=max(m,band(c,-0.46,0.46,aa)*band(ph,0.,36.,aS));   // centreline
    for(int e=0;e<2;e++){
      float se=e==0?s:L-s, ac=abs(c);
      if(hw>15.){
        float k=ac-2.85; if(k>0. && k<21.) m=max(m,band(mod(k,3.5),0.,1.75,aa)*band(se,6.,51.,aS));   // threshold: 6 + 6 bars
        m=max(m,band(se,311.,356.,aS)*band(ac,11.,20.,aa));                    // aiming point, 1,020 ft
        float b1=band(ac,11.,12.8,aa), b2=band(ac,14.3,16.1,aa), b3=band(ac,17.6,19.4,aa);
        m=max(m,band(se,152.,174.5,aS)*max(b1,max(b2,b3)));                  // touchdown zone 500 ft
        m=max(m,(band(se,457.,479.5,aS)+band(se,610.,632.5,aS))*max(b1,b2));  // 1,500 / 2,000 ft
        m=max(m,(band(se,762.,784.5,aS)+band(se,914.,936.5,aS))*b1);          // 2,500 / 3,000 ft
      } else { float k=ac-1.5; if(k>0. && k<8.) m=max(m,band(mod(k,2.),0.,1.,aa)*band(se,6.,36.,aS)); }
    }
    a=mix(a,mix(mix(a,asph,0.7),vec3(0.72,0.72,0.70),clamp(m,0.,1.)*fade),inside);
  }
  return a; }
vec3 groundAlbedo(vec2 en, float t, out float water){
  if(uGround==0) return procAlbedo(en,t,water);
  float wf, wn, ws, wd; vec4 f=sampleG(uGFar,uGBFar,en,wf), n=sampleG(uGNear,uGBNear,en,wn), s=sampleG(uGSite,uGBSite,en,ws), dd=sampleG(uGDetail,uGBDetail,en,wd);
  vec3 pa=vec3(0); water=0.; if(wf<0.999 && wn<0.999 && ws<0.999) pa=procAlbedo(en,t,water);   // fallback only outside the imagery
  vec3 a=mix(pa,f.rgb,wf); a=mix(a,n.rgb,wn); a=mix(a,s.rgb,ws); a=mix(a,dd.rgb,wd);
  water=mix(mix(water,f.a,wf),n.a,wn);
  // imagery is lit, hazy top-of-canopy colour: pull toward a surface albedo and add sub-texel variation up close
  a=a*0.85; float near=1.-smoothstep(2000.,9000.,t); a*=mix(1.,0.82+0.36*n2(en*0.03)*n2(en*0.11+3.),near);
  return paintRunways(en,t,a); }
// ---------------- 3D ground detail: buildings and trees from the imagery ----------------
// 16 m cells; each cell's centre colour in the aerial photo decides: dark green canopy -> tree (ellipsoid),
// light low-saturation or terracotta roof in built-up areas -> building (box, 4-9 m, occasional taller),
// otherwise nothing. 2D grid traversal from where the ray drops below 45 m to the ground hit.
const float CELL=16.;
uniform vec2 uAirport[32]; uniform int uAirportN;               // airport boundary (x east, z north): no imagery houses inside
bool inAirport(vec2 p){ bool c=false; for(int i=0,j=31;i<32;j=i++){ if(i>=uAirportN) break; if(j>=uAirportN) j=uAirportN-1;
  vec2 a=uAirport[i], b=uAirport[j]; if(((a.y>p.y)!=(b.y>p.y)) && (p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)) c=!c; } return c; }
float groundY(vec2 xz){ return dot(xz,xz)/12720000.; }          // world y of the ground (spherical Earth)
vec4 cellInfo(vec2 cc, out vec3 roof, out vec2 pos){   // type (0 none, 1 house, 2 tree), height, half-size, jitter; pos = footprint centre
  float w; vec3 a=groundAlbedo(cc+CELL*0.5,0.,w); roof=a; pos=cc+CELL*0.5;
  if(w>0.3 || inAirport(cc+CELL*0.5)) return vec4(0);
  float mx=max(a.r,max(a.g,a.b)), mn=min(a.r,min(a.g,a.b)); float sat=(mx-mn)/max(mx,1e-3); float lum=dot(a,vec3(0.3,0.59,0.11));
  float hsh=h21(cc*0.0625+vec2(17.3,4.1)), hs2=h21(cc*0.0625+vec2(3.7,9.9));
  bool roofy=(sat<0.22 && lum>0.16) || (a.r>a.g*1.15 && a.r>a.b*1.3 && lum>0.09);
  if(roofy && hsh<0.8){ pos+=(hs2-0.5)*CELL*0.2; return vec4(1., (hs2<0.015?10.+10.*hsh:3.2+3.8*hs2), CELL*(0.27+0.13*hsh), hs2); }
  // canopy: darkest green, textured sample among the cell quadrants (the photo's own trees)
  float bl=1.; vec3 ba=a; vec2 bp=pos; float lsum=0., l2sum=0.;
  for(int k=0;k<4;k++){ vec2 q=cc+vec2(k&1,k>>1)*CELL*0.5+CELL*0.25; float w2; vec3 c=groundAlbedo(q,0.,w2); float l=dot(c,vec3(0.3,0.59,0.11));
    lsum+=l; l2sum+=l*l; if(c.g>c.r*1.08 && c.g>c.b*1.3 && l<bl && w2<0.3){ bl=l; ba=c; bp=q; } }
  float var=l2sum/4.-pow(lsum/4.,2.);
  if(bl<0.08 && bl>0.02 && var>2e-5){ roof=ba; pos=bp; return vec4(2., 6.+8.*hsh, CELL*(0.26+0.12*hs2), hsh); }
  return vec4(0); }
// cell lookup from the GPU-generated cell map around the camera (FS_CITY); outside it: nothing
vec4 cellAt(vec2 cc, out vec3 roof, out vec2 pos){
  ivec2 ij=ivec2(floor((cc-uCityO.xy)/CELL+0.5)); roof=vec3(0); pos=cc+CELL*0.5;
  if(any(lessThan(ij,ivec2(0)))||any(greaterThanEqual(ij,ivec2(int(uCityO.z))))) return vec4(0);
  vec4 A=texelFetch(uCityA,ij,0), B=texelFetch(uCityB,ij,0);
  roof=vec3(B.z,B.w,A.w); pos=cc+B.xy; return vec4(A.xyz,h21(cc*0.0625+vec2(3.7,9.9))); }
float cityTrace(vec3 ro, vec3 rd, float tG, out vec3 nrm, out vec3 alb){
  if(rd.y>-0.0005 && ro.y>60.) return -1.;
  float t0= ro.y>45.+groundY(ro.xz) ? (ro.y-45.-groundY(ro.xz))/max(-rd.y,1e-4) : 0.;
  if(t0>=tG) return -1.;
  vec2 p=ro.xz+rd.xz*t0; vec2 c=floor(p/CELL); vec2 st=sign(rd.xz); vec2 inv=1./max(abs(rd.xz),vec2(1e-6));
  vec2 nb=(c+max(st,0.))*CELL; vec2 tm=t0+(nb-p)*inv*st; vec2 td=CELL*inv;
  for(int i=0;i<80;i++){
    vec2 cc=c*CELL; vec3 rf; vec2 ctr; vec4 ci=cellAt(cc,rf,ctr);
    if(ci.x>0.){ float gy=groundY(ctr);
      if(ci.x<1.5){   // house: stucco walls + hip roof (convex: 4 inward-sloping planes over the eaves), roof colour from the photo
        float hx=ci.z, hz=ci.z*(0.62+0.38*fract(ci.w*7.3)); if(fract(ci.w*13.1)>0.5){ float q=hx; hx=hz; hz=q; }
        float hw=ci.y>9.?ci.y:min(ci.y,3.4+2.6*step(0.85,fract(ci.w*5.7)));   // 1-2 storeys; rare taller blocks keep a flat roof
        vec3 o=ro-vec3(ctr.x,gy,ctr.y);
        vec3 bmin=vec3(-hx,0.,-hz), bmax=vec3(hx,hw,hz);
        vec3 ia=(bmin-o)/rd, ib=(bmax-o)/rd; vec3 tn=min(ia,ib), tf=max(ia,ib); float tN=max(max(tn.x,tn.y),tn.z), tF=min(min(tf.x,tf.y),tf.z);
        float tH=1e9; vec3 nH;
        if(tN<tF && tF>0. && tN<tG){ tH=max(tN,0.); nH= tN==tn.y?vec3(0,-sign(rd.y),0): tN==tn.x?vec3(-sign(rd.x),0,0):vec3(0,0,-sign(rd.z)); }
        float tR=1e9; vec3 nR;
        if(hw<9.){ float k=0.45, ov=0.6; float t0r=0., t1r=1e9; vec3 ne=vec3(0); bool ok=true;
          vec3 PN[5]=vec3[5](vec3(0,-1,0),vec3(1,1./k,0),vec3(-1,1./k,0),vec3(0,1./k,1),vec3(0,1./k,-1));
          float PD[5]=float[5](-hw, hx+ov+hw/k, hx+ov+hw/k, hz+ov+hw/k, hz+ov+hw/k);
          for(int j=0;j<5;j++){ float dn=dot(PN[j],rd), dist=PD[j]-dot(PN[j],o);
            if(abs(dn)<1e-6){ if(dist<0.) ok=false; } else { float tt=dist/dn; if(dn<0.){ if(tt>t0r){ t0r=tt; ne=PN[j]; } } else t1r=min(t1r,tt); } }
          if(ok && t0r<t1r && t0r<tG && t0r>0.){ tR=t0r; nR=normalize(ne); } }
        if(min(tH,tR)<1e8){ if(tR<tH){ nrm=nR; alb=rf*1.15*(0.85+0.3*n2(cc*0.37)); return tR; }
          nrm=nH; alb= nrm.y>0.5 ? rf*1.1 : mix(vec3(0.52,0.49,0.43),rf,0.2)*(0.82+0.3*h21(cc)); return tH; } }
      else {   // tree: trunk + three-lobe canopy (live oak / ficus-like), colour from the photo
        float hgt=ci.y, R=ci.z; float best=1e9; vec3 bn; vec3 bc; float br=1.;
        for(int k=0;k<3;k++){ float a=ci.w*31.+float(k)*2.1; vec2 off=k==0?vec2(0):vec2(cos(a),sin(a))*R*0.45;
          vec3 cen=vec3(ctr.x+off.x,gy+hgt*(k==0?0.62:0.5),ctr.y+off.y); vec3 rad=vec3(R*(k==0?0.8:0.62),hgt*(k==0?0.36:0.3),R*(k==0?0.8:0.62));
          vec3 oc=(ro-cen)/rad, dd=rd/rad; float b=dot(oc,dd), a2=dot(dd,dd), cq=dot(oc,oc)-1.; float h=b*b-a2*cq;
          if(h>0.){ float tt=(-b-sqrt(h))/a2; if(tt>0.&&tt<best){ best=tt; bn=normalize((ro+rd*tt-cen)/(rad*rad)); bc=cen; br=rad.y; } } }
        // trunk: vertical cylinder r 0.3 m from the ground to the canopy
        { vec2 d2=ro.xz-ctr; vec2 r2=rd.xz; float A=dot(r2,r2), B=dot(d2,r2), C=dot(d2,d2)-0.09; float hh=B*B-A*C;
          if(hh>0.&&A>1e-8){ float tt=(-B-sqrt(hh))/A; float yy=ro.y+rd.y*tt; if(tt>0.&&tt<best&&yy>gy&&yy<gy+hgt*0.45){ best=tt; bn=normalize(vec3((ro.xz+rd.xz*tt-ctr).x,0.,(ro.xz+rd.xz*tt-ctr).y)); bc=vec3(-1e9); } } }
        if(best<tG){ vec3 hp=ro+rd*best; nrm=bn;
          if(bc.x<-1e8){ alb=vec3(0.16,0.13,0.1); return best; }
          vec3 q=hp*0.9; nrm=normalize(nrm+0.6*vec3(n2(q.xy)-0.5,n2(q.yz+3.)-0.5,n2(q.zx+7.)-0.5));   // leafy normal
          alb=rf*vec3(1.5,1.9,1.3)*(0.55+0.65*n2(hp.xz*1.6+hp.y*1.3))*mix(0.5,1.,sat((hp.y-bc.y+br)/(2.*br))); return best; } } }
    float tnext=min(tm.x,tm.y); if(tnext>tG) break;
    if(tm.x<tm.y){ c.x+=st.x; tm.x+=td.x; } else { c.y+=st.y; tm.y+=td.y; } }
  return -1.; }

vec3 shadeGround(vec3 p, vec3 rd, float t){
  float water; vec3 alb=groundAlbedo(p.xz,t,water);
  if(uCity==1 && t<2500. && altOf(uCamPos)<1800.){   // contact shadow under the 3D houses / trees, fine grass / asphalt detail
    vec2 cc=floor(p.xz/CELL)*CELL; vec3 rf; vec2 ctr; vec4 ci=cellAt(cc,rf,ctr);
    if(ci.x>0.5&&ci.x<1.5){ float d=length(p.xz-ctr); alb*=mix(0.5,1.,smoothstep(ci.z*0.9,ci.z*1.6,d)); }   // houses only: the photo already holds the canopy shadows
    float f=1.-smoothstep(150.,900.,t); alb*=mix(1.,0.8+0.4*n2(p.xz*0.9)*n2(p.xz*3.1+7.),f); }
  // wet ground under radar-indicated rain (reflectivity at 800 m): darker, partly specular
  if(uUseNex==1){ vec3 uvw=(vec3(p.x,800.,p.z)-uNexO)/uNexS; if(all(greaterThan(uvw,vec3(0.)))&&all(lessThan(uvw,vec3(1.)))){
    float dbz=mix(texture(uNexA,uvw).r,texture(uNexB,uvw).r,uNexMix)*255.*0.25-10.; float wet=smoothstep(18.,38.,dbz);
    alb*=mix(1.,0.6,wet); water=max(water,0.28*wet); } }
  vec3 P=vec3(p.x/1000.,RG,p.z/1000.); vec3 up=normalize(vec3(p.x,6360000.,p.z)); float mu=dot(up,uSun);
  float tau=shadowTau(p+vec3(0.,5.,0.)); float cs=exp(-tau);
  vec3 Ts=transmittance(RG,mu)*earthShadow(RG,mu);
  vec3 Esun=uSunE*Ts*cs*max(mu,0.); vec3 Esky=ambientAt(tau)*PI;
  vec3 col=alb/PI*(Esun+Esky);
  if(water>0.02){
    float fade=1.-smoothstep(500.,25000.,t);
    vec2 q=p.xz+uWind*uTime*0.6; float tt=uTime;
    vec2 gq=vec2(n2(q*0.05+tt*0.4)-n2(q*0.05+vec2(3.1,1.7)-tt*0.3), n2(q*0.07+vec2(1.3,7.)+tt*0.35)-n2(q*0.07-vec2(5.,2.)-tt*0.33));
    vec3 N=normalize(up+vec3(gq.x,0.,gq.y)*0.16*fade);
    float rough=mix(0.06,0.22,smoothstep(0.,40000.,t));
    vec3 R=reflect(rd,N); R.y=abs(R.y);
    float cv=max(dot(-rd,N),0.); float F=0.02+0.98*pow(1.-cv,5.);
    vec3 skyR=skyLUT(vec3(P.x,RG+0.002,P.z),R)*exp(-0.5*tau)+cloudDiffuse(tau)*1.3;
    vec3 H=normalize(uSun-rd); float nh=max(dot(N,H),0.); float a2=rough*rough*rough*rough; float D=a2/(PI*pow(nh*nh*(a2-1.)+1.,2.));
    vec3 spec=Esun*D*F/max(4.*cv,0.05)*0.25;
    vec3 body=vec3(0.006,0.03,0.035)*(Esun+Esky)/PI;
    col=mix(col, mix(body,skyR,F)+spec, water);
  }
  col+=alb*uFlash*0.08*exp(-length(p.xz-uFlashPos.xz)/9000.);
  return col; }

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
  return vec2(d,id); }
vec3 jetNormal(vec3 p, int sg){ vec2 e=vec2(0.01,0.); return normalize(vec3(sdJet(p+e.xyy,sg).x-sdJet(p-e.xyy,sg).x, sdJet(p+e.yxy,sg).x-sdJet(p-e.yxy,sg).x, sdJet(p+e.yyx,sg).x-sdJet(p-e.yyx,sg).x)); }
void setupAmb(vec3 P){ vec3 up=normalize(P); vec3 sp=normalize(uSun-up*dot(uSun,up)+vec3(1e-5,0,0)); vec3 sq=cross(up,sp);
    gAmbTop=(skyLUT(P,up)*2.+skyLUT(P,normalize(up*0.5+sp*0.87))+skyLUT(P,normalize(up*0.5-sp*0.87))+skyLUT(P,normalize(up*0.5+sq*0.87))+skyLUT(P,normalize(up*0.5-sq*0.87)))/6.;
    float mu=max(uSun.y,0.); gSunT=transmittance(RG+8.,mu); gAmbBot=uSunE*gSunT*mu*0.12/PI*0.6; }
vec3 shadeSurf(vec3 wp, vec3 nw, vec3 rd, vec3 base, float rough, float metal){
  float tau=shadowTau(wp); float ccs=exp(-tau);
  vec3 P=vec3(wp.x/1000.,RG+wp.y/1000.,wp.z/1000.); float mu=dot(P,uSun)/length(P);
  vec3 Esun=uSunE*transmittance(length(P),mu)*ccs;
  float nl=max(dot(nw,uSun),0.); vec3 V=-rd; vec3 H=normalize(uSun+V); float nh=max(dot(nw,H),0.), nv=max(dot(nw,V),1e-3);
  float a2=rough*rough*rough*rough; float D=a2/(PI*pow(nh*nh*(a2-1.)+1.,2.)); float k=rough*rough*0.5; float G=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);
  vec3 F0=mix(vec3(0.04),base,metal); vec3 F=F0+(1.-F0)*pow(1.-max(dot(H,V),0.),5.);
  vec3 spec=D*G*F/max(4.*nv*nl,1e-3);
  vec3 diff=(1.-F)*(1.-metal)*base/PI;
  vec3 amb=mix(gAmbBot*exp(-0.3*tau),ambientAt(tau),nw.y*0.5+0.5)*PI;
  vec3 R=reflect(rd,nw); vec3 Fr=F0+(1.-F0)*pow(1.-nv,5.);
  vec3 env=mix(gAmbBot*PI*exp(-0.3*tau), skyLUT(P,R)*exp(-0.5*tau)+cloudDiffuse(tau)*1.5, smoothstep(-0.1,0.2,R.y));
  return diff*(Esun*nl+amb)+spec*Esun*nl+env*Fr*(1.-rough*0.7)+uFlash*base*2.*exp(-length(wp-uFlashPos)/6000.); }
float traceJet(vec3 ro, vec3 rd, vec3 pos, mat3 rot, int sg, vec3 tint, float ghost, out vec3 col){
  vec3 rom=transpose(rot)*(ro-pos); vec3 rdm=transpose(rot)*rd;
  float b=dot(rom,rdm); float c=dot(rom,rom)-14.*14.; float h=b*b-c; if(h<0.) return -1.;
  float t=max(0.,-b-sqrt(h)); float tEnd=-b+sqrt(h);
  for(int i=0;i<96;i++){ vec3 p=rom+rdm*t; vec2 d=sdJet(p,sg); if(d.x<0.004*max(t,1.)){
      vec3 n=jetNormal(p,sg); vec3 nw=rot*n;
      vec3 base=vec3(0.80); float rough=0.28, metal=0.;
      if(d.y<0.5){ if(abs(p.z-0.05)<0.22&&p.x<5.3) base=vec3(0.02,0.05,0.25); if(p.x>5.3&&p.x<6.9&&p.z>0.25){ base=vec3(0.01); rough=0.05; } if(p.x>-5.5&&p.x<4.5&&abs(p.z-0.35)<0.16&&mod(p.x+0.4,1.0)<0.45){ base=vec3(0.01); rough=0.05; } }
      else if(d.y>1.5){ base=vec3(0.55,0.56,0.58); metal=0.6; rough=0.35; }
      base=mix(base,tint,ghost);
      col=shadeSurf(ro+rd*t,nw,rd,base,rough,metal);
      return t; }
    t+=d.x*0.9; if(t>tEnd) break; }
  return -1.; }

// ---------------- clouds: raymarch ----------------
vec3 msPhase(float tau, float c){ float acc=0., a=1., b=1., g=1.;
  for(int o=0;o<4;o++){ float ph=mix(phaseHG(c,0.8*g),phaseHG(c,-0.25*g),0.25); acc+=b*exp(-tau*a)*ph; a*=0.4; b*=0.55; g*=0.5; }
  return vec3(acc); }
float lightMarch(vec3 p, float jit){ float tau=0., d=90.; vec3 q=p+uSun*d*jit;
  for(int i=0;i<6;i++){ q+=uSun*d; tau+=cloudSigma(q,altOf(q),1)*d; d*=1.75; }
  return tau+shadowTau(q); }   // remainder of the column to the top from the cloud-shadow map
vec4 marchClouds(vec3 ro, vec3 rd, float tmax, float dith, out float tDepth){
  tDepth=1e9;
  float h0=uUseNex==1?0.:min(uLayer.x,uStormBase), h1=uUseNex==1?max(uNexO.y+uNexS.y,uLayer.y):max(uLayer.y,uStorm.y+800.); if(uUseGoes==1) h1=max(h1,17500.);
  vec3 P=vec3(ro.x/1000.,RG+ro.y/1000.,ro.z/1000.); float r=length(P);
  vec2 o=rsph(P,rd,RG+h1/1000.); if(o.y<0.) return vec4(0,0,0,1);
  float ta=max(o.x,0.), tb=o.y; vec2 inr=rsph(P,rd,RG+h0/1000.);
  if(r<RG+h0/1000.) ta=max(ta,inr.y); else if(inr.x>0.) tb=min(tb,inr.x);
  ta*=1000.; tb=min(tb*1000.,min(tmax,220000.)); if(tb<=ta) return vec4(0,0,0,1);
  vec3 L=vec3(0); float T=1., tw=0., ws=0.;
  float cs=dot(rd,uSun);
  float t0=ta;
  int NMAX=int(150.*uQual); float dmin=(tb-ta)/float(NMAX)*0.5; float sPrev=1.; bool gCuPrev=false;
  for(int i=0;i<320;i++){ if(i>=NMAX||t0>tb||T<0.008) break;
    float dt=max(clamp(t0*0.014,25.,900.)/max(uQual,0.5), dmin);
    // thin, smooth media (deck, rain): ~0.25 optical depth per step; capped at 150 m inside the cumulus layer, and not
    // while the last sample was in a cumulus
    { float ha=altOf(ro+rd*t0); bool inCu=ha>uLayer.x-100.&&ha<uLayer.y+250.;
      if(!(inCu&&gCuPrev)) dt=max(dt, min(inCu?150.:500., 0.25/max(sPrev,1e-4))/max(uQual,0.5)); }
    float t=t0+dt*dith;
    vec3 p=ro+rd*t; float h=altOf(p);
    gLod=max(0.,log2(dt/50.)); gDetail=1.-smoothstep(15000.,40000.,t); gNearT=t; float s=cloudSigma(p,h,0); gCuPrev=gCu>1e-6; sPrev=s>1e-6?s:1.;
    if(s>1e-6){
      float lsave=gLod; gLod=1.5;
      // deep inside the deck the shadow map already says the sun is gone: skip the light march and AO probes
      float tauUp=shadowTau(p); bool deep=tauUp>14.;
      float gn=gNearT; gNearT=1e9; float tauL=deep?tauUp:lightMarch(p,dith); gNearT=gn;
      // ambient occlusion from cloud just above (short probes: cauliflower shading on cumulus and the deck base)
      float ao=exp(-cloudSigma(p+vec3(0,150,0),h+150.,1)*220.-cloudSigma(p+vec3(0,450,0),h+450.,1)*420.); gNearT=1e9; if(!deep) ao*=exp(-cloudSigma(p+vec3(0,1300,0),h+1300.,1)*600.);
      vec3 Pk=vec3(p.x/1000.,RG+h/1000.,p.z/1000.); float rr=length(Pk); float mu=dot(Pk,uSun)/rr;
      vec3 Ts=transmittance(rr,mu)*earthShadow(rr,mu);
      float powder=mix(1.,1.-exp(-s*600.),0.5*(1.-cs)*0.6);
      vec3 sunL=uSunE*Ts*msPhase(tauL,cs)*powder;
      vec3 amb=ambientAt(tauUp)*mix(0.22,1.15,ao)+gAmbBot*0.5*exp(-0.2*tauUp);
      vec3 fl=vec3(0.8,0.85,1.)*uFlash*25.*exp(-length(p-uFlashPos)/1500.);
      vec3 S=s*(sunL+amb+fl); gLod=lsave;
      float ex=exp(-s*dt);
      L+=T*(S-S*ex)/s; float w=T*(1.-ex); tw+=w*t; ws+=w; T*=ex;
      t0+=dt;
    } else { gNearT=1e9; t0+=max(dt*1.8,120.); }
  }
  if(ws>1e-4) tDepth=tw/ws;
  if(T<0.008) T=0.;   // terminated early: treat as opaque (the residual would leak the 2e4 sun disk through thick cloud)
  return vec4(L,T); }

void main(){
  float aspect=uRes.x/uRes.y;
  vec2 ndc=vUv+uJit;
  vec3 ro=uCamPos; vec3 rd=normalize(uCam*vec3(ndc.x*uTanFov*aspect, ndc.y*uTanFov, 1.));
  float dith=ign(gl_FragCoord.xy+5.588238*float(uFrame%64));
  vec3 P=vec3(ro.x/1000.,RG+ro.y/1000.,ro.z/1000.);
  setupAmb(P);
  vec2 g=rsph(P,rd,RG); float tG=g.x>0.?g.x*1000.:-1.;
  vec3 col; float tScene=1e9; float depth=1e9; float isJet=0.;
  if(tG>0.){
    float tB=-1.; vec3 bn, ba; if(uCity==1 && uGround==1 && altOf(ro)<1800. && tG<6000.) tB=cityTrace(ro,rd,tG,bn,ba);
    if(tB>0.){ vec3 p=ro+rd*tB; col=shadeSurf(p,bn,rd,ba,0.95,0.); float ao=sat((altOf(p)+1.)/6.); col*=0.5+0.5*ao; tG=tB; }
    else { vec3 p=ro+rd*tG; col=shadeGround(p,rd,tG); }
    vec3 Ta; vec3 La=aerial(ro,rd,tG,Ta,int(6.+4.*uQual),dith); col=col*Ta+La; tScene=tG; depth=tG; }
  else { col=skyLUT(P,rd)+sunDisk(P,rd); }
  if(uExt==1){ vec3 jc; float tj=traceJet(ro,rd,uAcPos,uAcRot,uStabGone,vec3(1.),0.,jc); if(tj>0.&&tj<tScene){ col=jc; tScene=tj; depth=tj; isJet=1.; } }
  if(uGhost==1){ vec3 gc; float tg=traceJet(ro,rd,uGhPos,uGhRot,0,vec3(1.,0.15,0.75),0.7,gc); if(tg>0.&&tg<tScene){ col=mix(col,gc,0.55); tScene=tg; depth=tg; } }
  float tc; vec4 cl=marchClouds(ro,rd,tScene,dith,tc);
  if(cl.a<0.999){ vec3 Tc; vec3 Lc=aerial(ro,rd,tc,Tc,6,dith); cl.rgb=cl.rgb*Tc+Lc*(1.-cl.a); if(cl.a<0.5){ depth=tc; isJet=0.; } }
  // sky seen from under/inside the cloud deck: the clear-sky LUT assumes a sunlit path; integrate the shadowed one instead
  if(tG<0. && depth>5e8 && cl.a>0.01 && uFarTau>0. && ro.y<16000.){ vec3 Ts; col=aerial(ro,rd,4e5,Ts,12,dith)+sunDisk(P,rd)*Ts; }
  col=col*cl.a+cl.rgb;
  oCol=vec4(max(col,vec3(0.)),1.);
  oDep=vec4(depth, isJet, 0., 0.);
}`;

// ---------------------------------------------------------------------------------------------------------------
// Temporal AA + upsample: reproject history with the previous camera (and the aircraft's own motion for jet pixels),
// clip it to the current neighbourhood in YCoCg, blend in tonemapped space.
export const FS_TAA = HEAD + `out vec4 o;
uniform sampler2D uCur, uDep, uHist; uniform vec2 uCurRes, uOutRes, uJitUv;
uniform vec3 uCamPos, uPCamPos; uniform mat3 uCam, uPCam; uniform float uTanFov, uPTanFov, uAspect; uniform int uReset;
uniform vec3 uAcPos, uPAcPos; uniform mat3 uAcRot, uPAcRot; uniform float uBlend;
vec3 toY(vec3 c){ return vec3(0.25*c.r+0.5*c.g+0.25*c.b, 0.5*c.r-0.5*c.b, -0.25*c.r+0.5*c.g-0.25*c.b); }
vec3 fromY(vec3 y){ return vec3(y.x+y.y-y.z, y.x+y.z, y.x-y.y-y.z); }
vec3 tm(vec3 c){ return c/(1.+max(c.r,max(c.g,c.b))); }
vec3 itm(vec3 c){ return c/max(1.-max(c.r,max(c.g,c.b)),1e-4); }
vec3 histCR(vec2 uv){ // 5-tap Catmull-Rom
  vec2 sp=uv*uOutRes, tc=floor(sp-0.5)+0.5, f=sp-tc; vec2 w0=f*(-0.5+f*(1.0-0.5*f)), w1=1.0+f*f*(-2.5+1.5*f), w2=f*(0.5+f*(2.0-1.5*f)), w3=f*f*(-0.5+0.5*f);
  vec2 w12=w1+w2, t0=(tc-1.)/uOutRes, t3=(tc+2.)/uOutRes, t12=(tc+w2/w12)/uOutRes;
  vec3 r=texture(uHist,vec2(t12.x,t0.y)).rgb*(w12.x*w0.y)+texture(uHist,vec2(t0.x,t12.y)).rgb*(w0.x*w12.y)+texture(uHist,t12).rgb*(w12.x*w12.y)+texture(uHist,vec2(t3.x,t12.y)).rgb*(w3.x*w12.y)+texture(uHist,vec2(t12.x,t3.y)).rgb*(w12.x*w3.y);
  float ws=w12.x*w0.y+w0.x*w12.y+w12.x*w12.y+w3.x*w12.y+w12.x*w3.y; return max(r/ws,vec3(0.)); }
void main(){
  vec2 uv=gl_FragCoord.xy/uOutRes; vec2 cuv=uv-uJitUv;
  vec3 cur=texture(uCur,cuv).rgb;
  ivec2 ci=ivec2(cuv*uCurRes); vec3 mn=vec3(1e9), mx=vec3(-1e9), m1=vec3(0), m2=vec3(0);
  float dmin=1e10; float jet=0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ ivec2 q=clamp(ci+ivec2(x,y),ivec2(0),ivec2(uCurRes)-1);
    vec3 c=toY(tm(texelFetch(uCur,q,0).rgb)); mn=min(mn,c); mx=max(mx,c); m1+=c; m2+=c*c;
    vec2 d=texelFetch(uDep,q,0).rg; if(d.x<dmin){ dmin=d.x; jet=d.y; } }
  m1/=9.; vec3 sd=sqrt(max(m2/9.-m1*m1,0.)); mn=max(mn,m1-1.6*sd); mx=min(mx,m1+1.6*sd);
  vec2 ndc=uv*2.-1.; vec3 rd=normalize(uCam*vec3(ndc.x*uTanFov*uAspect, ndc.y*uTanFov, 1.));
  vec3 v;
  if(dmin>5e8) v=rd; else { vec3 wp=uCamPos+rd*dmin; if(jet>0.5){ vec3 lp=transpose(uAcRot)*(wp-uAcPos); wp=uPAcPos+uPAcRot*lp; } v=wp-uPCamPos; }
  vec3 c=transpose(uPCam)*v; vec2 puv=vec2(c.x/(c.z*uPTanFov*uAspect), c.y/(c.z*uPTanFov))*0.5+0.5;
  float a=uBlend;
  bool off=c.z<=0.||any(lessThan(puv,vec2(0.)))||any(greaterThan(puv,vec2(1.)));
  vec3 res;
  if(uReset==1||off) res=cur;
  else { vec3 h=toY(tm(histCR(puv))); vec3 cc=toY(tm(cur));
    // clip toward the neighbourhood mean
    vec3 cen=0.5*(mx+mn), ext=0.5*(mx-mn)+1e-4; vec3 dv=h-cen; vec3 u=abs(dv/ext); float m=max(u.x,max(u.y,u.z)); if(m>1.) h=cen+dv/m;
    res=itm(fromY(mix(h,cc,a))); }
  o=vec4(res,1.); }`;

// Bloom: 13-tap downsample (Jimenez 2014) with Karis average on the first level, tent upsample
export const FS_DOWN = HEAD + `out vec4 o; uniform sampler2D uSrc; uniform vec2 uDst; uniform int uKaris;
float kw(vec3 c){ return 1./(1.+dot(c,vec3(0.2126,0.7152,0.0722))); }
void main(){ vec2 uv=gl_FragCoord.xy/uDst; vec2 s=1./vec2(textureSize(uSrc,0));
  vec3 a=texture(uSrc,uv+s*vec2(-2,2)).rgb, b=texture(uSrc,uv+s*vec2(0,2)).rgb, c=texture(uSrc,uv+s*vec2(2,2)).rgb;
  vec3 d=texture(uSrc,uv+s*vec2(-2,0)).rgb, e=texture(uSrc,uv).rgb, f=texture(uSrc,uv+s*vec2(2,0)).rgb;
  vec3 g=texture(uSrc,uv+s*vec2(-2,-2)).rgb, h=texture(uSrc,uv+s*vec2(0,-2)).rgb, i=texture(uSrc,uv+s*vec2(2,-2)).rgb;
  vec3 j=texture(uSrc,uv+s*vec2(-1,1)).rgb, k=texture(uSrc,uv+s*vec2(1,1)).rgb, l=texture(uSrc,uv+s*vec2(-1,-1)).rgb, m=texture(uSrc,uv+s*vec2(1,-1)).rgb;
  vec3 r;
  if(uKaris==1){ vec3 g0=(a+b+d+e)*0.25, g1=(b+c+e+f)*0.25, g2=(d+e+g+h)*0.25, g3=(e+f+h+i)*0.25, g4=(j+k+l+m)*0.25;
    float w0=kw(g0),w1=kw(g1),w2=kw(g2),w3=kw(g3),w4=kw(g4);
    r=(g0*w0*0.125+g1*w1*0.125+g2*w2*0.125+g3*w3*0.125+g4*w4*0.5)/(w0*0.125+w1*0.125+w2*0.125+w3*0.125+w4*0.5); }
  else r=e*0.125+(a+c+g+i)*0.03125+(b+d+f+h)*0.0625+(j+k+l+m)*0.125;
  o=vec4(min(r,vec3(60000.)),1.); }`;
export const FS_UP = HEAD + `out vec4 o; uniform sampler2D uSrc; uniform float uRadius; uniform vec2 uDst;
void main(){ vec2 sz=vec2(textureSize(uSrc,0)); vec2 uv=gl_FragCoord.xy/uDst; vec2 s=uRadius/sz;
  vec3 r=texture(uSrc,uv+vec2(-s.x,s.y)).rgb+texture(uSrc,uv+vec2(0,s.y)).rgb*2.+texture(uSrc,uv+s).rgb
        +texture(uSrc,uv+vec2(-s.x,0)).rgb*2.+texture(uSrc,uv).rgb*4.+texture(uSrc,uv+vec2(s.x,0)).rgb*2.
        +texture(uSrc,uv-s).rgb+texture(uSrc,uv+vec2(0,-s.y)).rgb*2.+texture(uSrc,uv+vec2(s.x,-s.y)).rgb;
  o=vec4(r/16.,1.); }`;

// Eye adaptation: average log luminance of the smallest bloom level, exponential adaptation toward a partial key
export const FS_EXPO = HEAD + `out vec4 o; uniform sampler2D uSrc, uPrev; uniform float uDt; uniform float uRef; uniform int uReset;
void main(){ float s=0., w=0.;
  for(int y=0;y<6;y++) for(int x=0;x<8;x++){ vec2 uv=(vec2(x,y)+0.5)/vec2(8.,6.); float l=dot(texture(uSrc,uv).rgb,vec3(0.2126,0.7152,0.0722));
    float ww=1.-0.6*length(uv-0.5); s+=log2(max(l,1e-5))*ww; w+=ww; }
  float L=exp2(s/w);
  float target=0.62/(pow(L,0.8)*pow(uRef,0.2)); target=clamp(target,0.01,40.);
  float prev=texture(uPrev,vec2(0.5)).r; if(uReset==1||prev<=0.) prev=target;
  float k=1.-exp(-uDt*(target>prev?2.2:1.4));
  o=vec4(exp(mix(log(prev),log(target),k)),0,0,1); }`;

export const FS_FINAL = HEAD + `out vec4 o; uniform sampler2D uHdr, uBloom, uExpo, uGhost, uMeshTex, uSceneTex; uniform int uHasMesh; uniform vec2 uOutRes; uniform float uBloomStr; uniform int uFrame; uniform float uFlash; uniform vec3 uSunScr; uniform float uSunR;
vec3 aces(vec3 v){ // ACES fitted (Hill)
  const mat3 i=mat3(0.59719,0.07600,0.02840, 0.35458,0.90834,0.13383, 0.04823,0.01566,0.83777);
  const mat3 ou=mat3(1.60475,-0.10208,-0.00327, -0.53108,1.10813,-0.07276, -0.07367,-0.00605,1.07602);
  v=i*v; vec3 a=v*(v+0.0245786)-0.000090537; vec3 b=v*(0.983729*v+0.4329510)+0.238081; return clamp(ou*(a/b),0.,1.); }
vec3 srgb(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1./2.4))-0.055, step(0.0031308,c)); }
float h12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){ vec2 uv=gl_FragCoord.xy/uOutRes;
  float e=texture(uExpo,vec2(0.5)).r;
  vec3 c=texture(uHdr,uv).rgb; vec3 b=texture(uBloom,uv).rgb/6.;
  if(uHasMesh==1){ vec4 m=texture(uMeshTex,uv); c=c*(1.-m.a)+m.rgb; }
  c=mix(c,b,uBloomStr)*e*1.15;
  // sun glare + lens ghosts, only when the sun disk itself is unoccluded (tested on the 1/8-res HDR image)
  if(uSunScr.z>0.5){ vec2 s=uSunScr.xy; float asp=uOutRes.x/uOutRes.y;
    float lum=0.; for(int k=0;k<5;k++){ vec2 o2=vec2(k==1?1.:k==2?-1.:0., k==3?1.:k==4?-1.:0.)*0.004; lum=max(lum,dot(texture(uSceneTex,s+o2*0.25).rgb,vec3(0.2126,0.7152,0.0722))); }   // raw scene: TAA compresses the tiny disk
    float vis=smoothstep(150.,1500.,lum)*smoothstep(-0.05,0.05,min(min(s.x,1.-s.x),min(s.y,1.-s.y)));   // unoccluded disk is ~1e3-1e4 in HDR
    if(vis>0.){ vec2 d=(uv-s)*vec2(asp,1.); float r=length(d); float ang=atan(d.y,d.x);
      float star=pow(abs(cos(ang*3.)),60.)+pow(abs(cos(ang*3.+0.52)),60.)*0.6;
      c+=vis*vec3(1.,0.96,0.88)*(0.7*exp(-r*14.)+0.06*exp(-r*4.)+star*0.12*exp(-r*13.)+12.*smoothstep(uSunR*1.25,uSunR*0.75,r));
      vec2 ax=vec2(0.5)-s;
      const vec3 T0=vec3(0.9,0.6,0.3), T1=vec3(0.3,0.7,0.9), T2=vec3(0.6,0.9,0.5), T3=vec3(0.8,0.4,0.9);
      float kk[4]=float[4](0.6,1.2,1.55,2.1); float rr[4]=float[4](0.03,0.06,0.025,0.11); vec3 tt[4]=vec3[4](T0,T1,T2,T3);
      for(int i=0;i<4;i++){ vec2 gp=s+ax*kk[i]; float gd=length((uv-gp)*vec2(asp,1.)); c+=vis*tt[i]*0.05*smoothstep(rr[i],rr[i]*0.6,gd); }
      float hr=length((uv-(s+ax*1.))*vec2(asp,1.)); c+=vis*vec3(0.5,0.6,0.9)*0.014*exp(-pow((hr-0.32)/0.02,2.)); } }
  c=aces(c);
  vec2 q=uv-0.5; c*=1.-0.22*dot(q,q)*2.;
  c=srgb(c);
  c+=(h12(gl_FragCoord.xy+float(uFrame%97)*13.1)-0.5)/255.*1.5;
  o=vec4(c,1.); }`;


// ---------------------------------------------------------------------------------------------------------------
// Exterior Learjet (data/ext, PAD model): forward pass at output resolution into a 4x MSAA HDR target, shaded with
// the scene's lighting (sun through the cloud-shadow map, sky/diffuse ambient, sky reflections), fogged by a short
// cloud march to the camera toward the background radiance; composited over the TAA image in the final pass.
export const VS_MESH = `#version 300 es
in vec3 aPos; in vec3 aNor; in vec2 aUv;
uniform mat4 uModel; uniform mat3 uAcB; uniform vec3 uAcRel; uniform mat3 uCam; uniform float uTanFov, uAspect;
out vec3 vNor; out vec2 vUv; out vec3 vRel;
void main(){ vec4 mp=uModel*vec4(aPos,1.); vec3 rel=uAcB*(mp.xyz+vec3(0.,0.,0.39))+uAcRel; vRel=rel; vNor=uAcB*(mat3(uModel)*aNor); vUv=aUv;
  vec3 v=transpose(uCam)*rel; float n=0.3, f=30000.;
  gl_Position=vec4(v.x/(uTanFov*uAspect), v.y/uTanFov, v.z*(f+n)/(f-n)-2.*f*n/(f-n), v.z); }`;
const pickS=(a,b)=>FS_SCENE.slice(FS_SCENE.indexOf(a),FS_SCENE.indexOf(b));
export const FS_MESH = HEAD + `in vec3 vNor; in vec2 vUv; in vec3 vRel; out vec4 o;
uniform sampler2D uSkyView, uCShadow; uniform vec4 uCSO; uniform float uFarTau, uSunE, uFlash; uniform vec3 uFlashPos;
uniform sampler2D uTex, uBg; uniform int uHasTex, uKind; uniform vec4 uDiffuse; uniform vec3 uCamPos; uniform vec2 uOutRes; uniform float uBeacon;
vec3 gAmbTop, gAmbBot, gSunT;
` + ATMO + CLOUDS + pickS('// Diffuse light field','float ign(') + pickS('// ---------------- sky','// ---------------- aerial') + pickS('void setupAmb(','float traceJet(') + `
void main(){ vec3 n=normalize(vNor); if(dot(n,vRel)>0.) n=-n;
  vec4 c=uHasTex==1?texture(uTex,vUv):vec4(uDiffuse.rgb,0.3);
  vec3 alb=c.rgb; float gloss=uHasTex==1?0.35+0.55*c.a:0.35;
  if(uKind==1){ alb=vec3(0.012,0.016,0.02); gloss=0.98; }
  vec3 P=vec3(uCamPos.x/1000.,RG+uCamPos.y/1000.,uCamPos.z/1000.); setupAmb(P);
  vec3 rd=normalize(vRel); vec3 wp=uCamPos+vRel; float d=length(vRel);
  vec3 col= uKind==2 ? alb*40.+alb*2. : uKind==3 ? alb*(300.*uBeacon+2.) : shadeSurf(wp,n,rd,alb,mix(0.65,0.06,min(gloss,0.95)/0.95),0.);
  gLod=1.; float tau=0.; for(int i=0;i<5;i++){ vec3 q=uCamPos+vRel*((float(i)+0.5)/5.); tau+=cloudSigma(q,altOf(q),1)*d/5.; }
  vec3 bg=texture(uBg,gl_FragCoord.xy/uOutRes).rgb;
  o=vec4(mix(bg,col,exp(-tau)),1.); }`;


// Real building footprints (OpenStreetMap, tools/fetch_osm_buildings.py), extruded in js/render.js: walls + hip or flat
// roofs. Drawn in the same full-resolution MSAA pass as the aircraft; roof colour from the aerial photo at the roof,
// hidden behind nearer ray-traced trees via the scene distance buffer; lit, hazed and fogged like the rest of the scene.
export const VS_BLD = `#version 300 es
in vec3 aPos; in vec2 aUv;
uniform vec3 uOff; uniform mat3 uCam; uniform float uTanFov, uAspect;
out vec2 vUv; out vec3 vRel; out vec3 vW;
void main(){ vec3 rel=aPos+uOff; vRel=rel; vUv=aUv; vW=aPos;
  vec3 v=transpose(uCam)*rel; float n=0.5, f=30000.;
  gl_Position=vec4(v.x/(uTanFov*uAspect), v.y/uTanFov, v.z*(f+n)/(f-n)-2.*f*n/(f-n), v.z); }`;
export const FS_BLD = HEAD + `in vec2 vUv; in vec3 vRel; in vec3 vW; out vec4 o;
uniform sampler2D uSkyView, uCShadow; uniform vec4 uCSO; uniform float uFarTau, uSunE, uFlash; uniform vec3 uFlashPos;
uniform sampler2D uGSite, uSceneDep, uBg; uniform vec4 uGBSite; uniform vec3 uCamPos, uOrigin; uniform vec2 uOutRes;
vec3 gAmbTop, gAmbBot, gSunT;
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
` + ATMO + CLOUDS + pickS('// Diffuse light field','float ign(') + pickS('// ---------------- sky','// ---------------- ground') + pickS('void setupAmb(','float traceJet(') + `
void main(){
  vec3 rd=normalize(vRel); float d=length(vRel);
  vec2 sp=gl_FragCoord.xy/uOutRes; float ds=texture(uSceneDep,sp).r; if(ds<d-3.) discard;   // a nearer tree
  vec3 n=normalize(cross(dFdx(vW),dFdy(vW))); if(dot(n,rd)>0.) n=-n;   // flat facet normal (vertices are shared)
  vec3 wp=uCamPos+vRel; vec2 en=wp.xz;
  vec3 alb;
  if(vUv.x>0.5){ vec2 uv=vec2((en.x-uGBSite.x)/(uGBSite.y-uGBSite.x),(uGBSite.w-en.y)/(uGBSite.w-uGBSite.z)); alb=textureLod(uGSite,clamp(uv,0.,1.),0.).rgb*1.05; }
  else { float hb=vUv.y; alb=mix(vec3(0.62,0.58,0.5),vec3(0.72,0.66,0.6),hb)*mix(0.85,1.,fract(hb*7.))*(0.92+0.08*step(0.5,fract(vW.y*0.33)));   // stucco
    float win=step(0.35,fract(vW.y/3.2))*step(fract(vW.y/3.2),0.75)*step(0.3,fract((vW.x+vW.z)/2.6))*step(fract((vW.x+vW.z)/2.6),0.7)*step(1.,vW.y-uOrigin.y);
    alb=mix(alb,vec3(0.05,0.06,0.07),win*0.85); }
  vec3 P=vec3(uCamPos.x/1000.,RG+uCamPos.y/1000.,uCamPos.z/1000.); setupAmb(P);
  vec3 col=shadeSurf(wp,n,rd,alb,vUv.x>0.5?0.75:0.9,0.);
  vec3 Ta; vec3 La=aerial(uCamPos,rd,d,Ta,6,0.5); col=col*Ta+La;
  gLod=1.; float tau=0.; for(int i=0;i<4;i++){ vec3 q=uCamPos+vRel*((float(i)+0.5)/4.); tau+=cloudSigma(q,altOf(q),1)*d/4.; }
  o=vec4(mix(texture(uBg,sp).rgb,col,exp(-tau)),1.); }`;

// Real trees (Meta/WRI canopy height map, tools/fetch_canopy_trees.py) as GPU instances: unit tree mesh (three canopy
// lobes + trunk, or one blob far away) scaled by each tree's height and crown radius, rotated by its seed; canopy colour
// from the aerial photo at the tree. Same full-resolution MSAA pass, lighting and fog as the buildings.
export const VS_TREE = `#version 300 es
in vec3 aPos; in vec3 aNor; in vec2 aUv; in vec4 iTree; in float iSeed;
uniform vec3 uOff, uOrigin; uniform mat3 uCam; uniform float uTanFov, uAspect; uniform sampler2D uGSite; uniform vec4 uGBSite; uniform float uTrunk;
out vec3 vRel; out vec3 vN; flat out vec3 vCol; out float vPart; out vec3 vW;
void main(){ float a=iSeed*6.2832, ca=cos(a), sa=sin(a); float part=aUv.x;
  vec3 p=aPos; vec3 nn=aNor;
  if(part<0.5){ p=vec3(p.x*iTree.w, p.y*iTree.z, p.z*iTree.w); nn=normalize(vec3(nn.x/iTree.w, nn.y/iTree.z, nn.z/iTree.w)); }
  else { float tr=part>1.5?0.17:0.28; p=vec3(p.x*tr, (part<1.5?p.y*uTrunk/0.55:p.y)*iTree.z, p.z*tr); if(part>1.5) p.xz+=vec2(0.35,0.15)*iTree.z*0.04*p.y*p.y/(iTree.z*iTree.z+1.); }   // palm trunks are slender, slightly leaning
  p.xz=mat2(ca,-sa,sa,ca)*p.xz; nn.xz=mat2(ca,-sa,sa,ca)*nn.xz;
  vec2 wxz=uOrigin.xz+iTree.xy; float gy=dot(wxz,wxz)/12720000.;
  vec3 local=vec3(iTree.x,gy,iTree.y)+p;
  vec3 rel=local+uOff; vRel=rel; vN=nn; vPart=part; vW=vec3(wxz.x,gy,wxz.y)+p;
  vec2 uv=vec2((wxz.x-uGBSite.x)/(uGBSite.y-uGBSite.x),(uGBSite.w-wxz.y)/(uGBSite.w-uGBSite.z));
  vec3 c=textureLod(uGSite,clamp(uv,0.,1.),2.).rgb; float l=dot(c,vec3(0.3,0.59,0.11));
  vCol=mix(vec3(0.05,0.09,0.035),c*vec3(0.9,1.2,0.8),0.55)*(0.75+0.5*fract(iSeed*13.7));   // greener than the shaded photo canopy
  vec3 v=transpose(uCam)*rel; float n=0.5, f=30000.;
  gl_Position=vec4(v.x/(uTanFov*uAspect), v.y/uTanFov, v.z*(f+n)/(f-n)-2.*f*n/(f-n), v.z); }`;
export const FS_TREE = HEAD + `in vec3 vRel; in vec3 vN; flat in vec3 vCol; in float vPart; in vec3 vW; out vec4 o;
uniform sampler2D uSkyView, uCShadow; uniform vec4 uCSO; uniform float uFarTau, uSunE, uFlash; uniform vec3 uFlashPos;
uniform sampler2D uSceneDep, uBg; uniform vec3 uCamPos; uniform vec2 uOutRes;
vec3 gAmbTop, gAmbBot, gSunT;
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 x){ vec2 p=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(mix(h21(p),h21(p+vec2(1,0)),f.x),mix(h21(p+vec2(0,1)),h21(p+vec2(1,1)),f.x),f.y); }
` + ATMO + CLOUDS + pickS('// Diffuse light field','float ign(') + pickS('// ---------------- sky','// ---------------- ground') + pickS('void setupAmb(','float traceJet(') + `
void main(){
  vec3 rd=normalize(vRel); float d=length(vRel);
  vec2 sp=gl_FragCoord.xy/uOutRes; if(texture(uSceneDep,sp).r<d-3.) discard;
  vec3 n=normalize(vN); if(dot(n,rd)>0.) n=-n;
  vec3 alb=vCol;
  if(vPart<0.5){ vec3 q=vW*0.9; n=normalize(n+0.6*vec3(n2(q.xy)-0.5,n2(q.yz+3.)-0.5,n2(q.zx+7.)-0.5));   // leafy normal
    alb*=0.6+0.7*n2(vW.xz*1.6+vW.y*1.3); }
  else alb=vPart>1.5?vec3(0.32,0.28,0.23)*(0.85+0.3*fract(vW.y*1.7)):vec3(0.16,0.13,0.1);   // palm trunk rings / bark
  vec3 wp=uCamPos+vRel; vec3 P=vec3(uCamPos.x/1000.,RG+uCamPos.y/1000.,uCamPos.z/1000.); setupAmb(P);
  vec3 col=shadeSurf(wp,n,rd,alb,0.95,0.);
  vec3 Ta; vec3 La=aerial(uCamPos,rd,d,Ta,5,0.5); col=col*Ta+La;
  gLod=1.; float tau=0.; for(int i=0;i<3;i++){ vec3 q=uCamPos+vRel*((float(i)+0.5)/3.); tau+=cloudSigma(q,altOf(q),1)*d/3.; }
  o=vec4(mix(texture(uBg,sp).rgb,col,exp(-tau)),1.); }`;

// Cell map generator: one texel per 16 m cell around the camera, classified from the imagery (cellInfo).
// A = (type, height, half-size, roof b), B = (footprint centre x, z within the cell, roof r, g).
export const FS_CITY = HEAD + `layout(location=0) out vec4 oA; layout(location=1) out vec4 oB;
uniform sampler2D uGNear, uGFar, uGSite, uGDetail; uniform int uGround; uniform vec4 uGBNear, uGBFar, uGBSite, uGBDetail; uniform vec4 uCityO; uniform vec4 uOsmB;
float sat(float x){ return clamp(x,0.,1.); }
` + pickS('float h21(','// ---------------- sky') + pickS('// ---------------- ground','const float CELL').replace('texture(s,clamp(uv,0.,1.))','textureLod(s,clamp(uv,0.,1.),0.)') + pickS('const float CELL','// cell lookup') + `
void main(){ vec2 cc=uCityO.xy+floor(gl_FragCoord.xy)*uCityO.w; vec3 rf; vec2 pos; vec4 ci=cellInfo(cc,rf,pos);
  if(cc.x>uOsmB.x&&cc.x<uOsmB.y&&cc.y>uOsmB.z&&cc.y<uOsmB.w) ci=vec4(0);   // real footprints and trees drawn there
  oA=vec4(ci.xyz,rf.b); oB=vec4(pos-cc,rf.r,rf.g); }`;

// Precipitation streaks: drops in a box that wraps around the camera, each drawn as its motion relative to the camera
// over the exposure time. Drawn over the tonemapped image (canvas), alpha by intensity and distance.
export const VS_RAIN = `#version 300 es
uniform mat4 uVP; uniform vec3 uCamPos, uFall, uRel; uniform float uBox, uTime, uLen;
out float vA;
vec3 h3(float n){ return fract(sin(vec3(n,n+1.7,n+3.1))*vec3(43758.5453,22578.1459,19642.3490)); }
void main(){ int i=gl_VertexID/2; float e=float(gl_VertexID%2);
  vec3 h=h3(float(i)*0.6180339);
  vec3 p=uCamPos+mod(h*uBox+uFall*uTime-uCamPos,uBox)-uBox*0.5;
  p-=uRel*uLen*e;
  vec4 c=uVP*vec4(p,1.); gl_Position=c;
  float d=length(p-uCamPos); vA=(1.-smoothstep(uBox*0.2,uBox*0.5,d))*smoothstep(3.,9.,d)*(1.-0.7*e); }`;
export const FS_RAIN = `#version 300 es
precision highp float; in float vA; uniform vec4 uColor; out vec4 o; void main(){ o=vec4(uColor.rgb,uColor.a*vA); }`;

export const VS_LINE = `#version 300 es
in vec3 aPos; uniform mat4 uVP; out float vD; void main(){ vec4 c=uVP*vec4(aPos,1.); gl_Position=c; vD=c.w; }`;
export const FS_LINE = `#version 300 es
precision highp float; in float vD; uniform vec4 uColor; out vec4 o; void main(){ o=vec4(uColor.rgb, uColor.a*clamp(1.-vD/60000.,0.15,1.)); }`;
