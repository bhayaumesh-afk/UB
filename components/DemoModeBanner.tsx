export default function DemoModeBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      data-testid="demo-mode-banner"
      className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      {message}
    </div>
  );
}
