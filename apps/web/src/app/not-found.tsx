export default function NotFound() {
  return (
    <div className="app-h grid place-items-center p-6 text-center">
      <div>
        <p className="font-mono text-5xl text-accent" dir="ltr">404</p>
        <p className="mt-3 text-ink-2">الصفحة غير موجودة.</p>
        <a className="btn mt-5" href="/">
          العودة إلى المشاريع
        </a>
      </div>
    </div>
  );
}
