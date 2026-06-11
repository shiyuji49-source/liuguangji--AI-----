export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <div className="text-2xl tracking-[0.3em] text-primary">鎏光机</div>
        <div className="mt-2 text-sm text-muted-foreground">AI 剧制作平台</div>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
