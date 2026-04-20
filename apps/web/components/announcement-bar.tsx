import { ArrowRight } from "lucide-react";
import { announcement } from "@/lib/content";

export function AnnouncementBar() {
  if (!announcement.enabled) return null;
  return (
    <div className="bg-mint-surface text-mint-dark">
      <div className="container-p flex h-10 items-center justify-center gap-3 text-small">
        <span>{announcement.text}</span>
        <a href={announcement.linkHref} className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
          {announcement.linkText}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
    </div>
  );
}
