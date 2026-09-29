import type { SVGProps } from 'react';

/** One authored set: 16px grid, 1.5 stroke, round joins, currentColor. */
function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export const SearchIcon = () => (
  <Svg>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.2 10.2 13.5 13.5" />
  </Svg>
);

/** Turn the card over. */
export const FlipIcon = () => (
  <Svg>
    <path d="M3 6.5h8.5a2 2 0 0 1 0 4H9" />
    <path d="M5.5 4 3 6.5 5.5 9" />
  </Svg>
);

export const UpIcon = () => (
  <Svg>
    <path d="M4.5 9.5 8 6l3.5 3.5" />
  </Svg>
);

export const DownIcon = () => (
  <Svg>
    <path d="M4.5 6.5 8 10l3.5-3.5" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </Svg>
);

export const PlusIcon = () => (
  <Svg>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
);

/** Open the full-page catalog. */
export const CabinetIcon = () => (
  <Svg>
    <rect x="2.75" y="2.5" width="10.5" height="11" rx="1" />
    <path d="M2.75 8h10.5" />
    <path d="M6.5 5.25h3M6.5 10.75h3" />
  </Svg>
);

/** Settings: three sliders. (A cog at 16px reads as a sun.) */
export const SlidersIcon = () => (
  <Svg>
    <path d="M2.75 4.5h2M7.5 4.5h5.75M2.75 8h6.75M12.25 8h1M2.75 11.5h.75M6.25 11.5h7" />
    <circle cx="6.1" cy="4.5" r="1.35" />
    <circle cx="10.9" cy="8" r="1.35" />
    <circle cx="4.9" cy="11.5" r="1.35" />
  </Svg>
);

/** A tab with no favicon of its own (new tab, chrome:// pages, PDFs). */
export const GlobeIcon = ({ className = 'icon' }: { className?: string }) => (
  <Svg className={className}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M2.5 8h11M8 2.5c1.6 1.6 2.4 3.4 2.4 5.5S9.6 11.9 8 13.5M8 2.5C6.4 4.1 5.6 5.9 5.6 8s.8 3.9 2.4 5.5" />
  </Svg>
);

/** A saved link with no favicon. */
export const LinkIcon = () => (
  <Svg>
    <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54l-.75.75" />
    <path d="M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54l.75-.75" />
  </Svg>
);
