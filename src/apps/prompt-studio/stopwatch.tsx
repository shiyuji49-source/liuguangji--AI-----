"use client";

import { useEffect, useState } from "react";

/**
 * 生成类操作读秒：running 期间每秒 +1，停止显示 0。
 * 只在定时器回调里 setState（不在 effect 体内同步 setState、不在 render 读 ref/Date，满足 React 编译器纯度规则）。
 */
export function useStopwatch(running: boolean): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!running) return;
    let n = 0;
    const reset = setTimeout(() => setSec(0), 0); // 新一轮开始即归零，避免闪上一轮残留
    const id = setInterval(() => {
      n += 1;
      setSec(n);
    }, 1000);
    return () => {
      clearTimeout(reset);
      clearInterval(id);
    };
  }, [running]);
  return running ? sec : 0;
}

/** 读秒小标：生成中显示已耗时（0:42 / 8s），停止后不渲染。 */
export function Elapsed({ running, className }: { running: boolean; className?: string }) {
  const sec = useStopwatch(running);
  if (!running) return null;
  return <span className={`tabular-nums ${className ?? "opacity-80"}`}>{fmtElapsed(sec)}</span>;
}

export function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}
