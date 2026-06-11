export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <div className="text-liuguang text-3xl font-medium tracking-[0.35em]">鎏光机</div>
        <div className="mt-3 text-sm tracking-[0.2em] text-muted-foreground">AI 剧 制 作 平 台</div>
        <div className="liuguang-line mx-auto mt-5 h-px w-48 opacity-70" />
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
