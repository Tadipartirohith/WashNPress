"use client";

import { useEffect, useRef } from "react";

// A dependency free WebGL raymarched glass droplet. It renders the brand mark as a
// living 3D object, tints to aqua and mint, and respects the reduced motion setting.
export function Droplet({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const vs = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
    const fs = [
      "precision highp float;",
      "uniform vec2 R; uniform float T; uniform vec2 M;",
      "mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}",
      "float map(vec3 p){p.xz*=rot(T*0.35+M.x*0.8);p.yz*=rot(sin(T*0.4)*0.25+M.y*0.5);",
      " float w=0.06*sin(4.0*p.y+T)*sin(3.0*p.x+T*1.2)+0.04*sin(5.0*p.z+T*0.8);return length(p)-(1.15+w);}",
      "vec3 nrm(vec3 p){vec2 e=vec2(0.001,0.);return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx)));}",
      "void main(){vec2 uv=(gl_FragCoord.xy-0.5*R)/min(R.x,R.y);vec3 ro=vec3(0.,0.,3.2),rd=normalize(vec3(uv,-1.6));",
      " float t=0.0;float hit=0.0;vec3 pos;for(int i=0;i<72;i++){pos=ro+rd*t;float d=map(pos);if(d<0.001){hit=1.0;break;}t+=d;if(t>6.0)break;}",
      " vec3 col=vec3(0.0);float a=0.0;float glow=exp(-2.3*abs(length(uv)-0.42));col+=vec3(0.0,0.78,0.78)*glow*0.35;a+=glow*0.16;",
      " if(hit>0.5){vec3 n=nrm(pos);vec3 L=normalize(vec3(0.7,0.9,0.7));float dif=clamp(dot(n,L),0.0,1.0);",
      "  float fres=pow(1.0-clamp(dot(n,-rd),0.0,1.0),3.0);vec3 aqua=vec3(0.0,0.79,0.79),mint=vec3(0.23,0.94,0.84),amber=vec3(0.96,0.65,0.14);",
      "  vec3 base=mix(aqua,mint,0.5+0.5*n.y);vec3 h=normalize(L-rd);float spec=pow(clamp(dot(n,h),0.0,1.0),64.0);",
      "  vec3 c=base*(0.35+0.75*dif)+vec3(spec)*1.1+fres*mint*0.9+amber*fres*0.25;col=mix(col,c,0.92);a=clamp(a+0.85+fres*0.5,0.0,1.0);}",
      " gl_FragColor=vec4(col*a,a);}",
    ].join("\n");
    function sh(type: number, src: string) {
      const o = gl!.createShader(type)!;
      gl!.shaderSource(o, src);
      gl!.compileShader(o);
      return o;
    }
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(pr);
    gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const uR = gl.getUniformLocation(pr, "R");
    const uT = gl.getUniformLocation(pr, "T");
    const uM = gl.getUniformLocation(pr, "M");
    let mx = 0, my = 0;
    const onMove = (e: PointerEvent) => { mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5; };
    window.addEventListener("pointermove", onMove);
    const resize = () => {
      const d = Math.min(window.devicePixelRatio, 2);
      cv.width = cv.clientWidth * d;
      cv.height = cv.clientHeight * d;
      gl.viewport(0, 0, cv.width, cv.height);
    };
    resize();
    window.addEventListener("resize", resize);
    const t0 = performance.now();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = reduce ? 0.6 : (performance.now() - t0) / 1000;
      gl.uniform2f(uR, cv.width, cv.height);
      gl.uniform1f(uT, t);
      gl.uniform2f(uM, mx, my);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
