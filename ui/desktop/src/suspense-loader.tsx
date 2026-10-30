import BrandLogo from './branding/BrandLogo';

export default function SuspenseLoader() {
  return (
    <div className="flex flex-col items-start justify-end w-screen h-screen overflow-hidden p-6 page-transition">
      <div className="flex gap-2 items-center justify-end">
        <BrandLogo size="small" />
        <span className="text-text-secondary">Loading...</span>
      </div>
    </div>
  );
}
