import type { SVGProps } from "react";

const paths = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  mic: "M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V6ZM5 11a7 7 0 0 0 14 0M12 18v3M9 21h6",
  report: "M14 3H6v18h12V7l-4-4ZM14 3v5h4M9 12h6M9 16h6",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87",
  check: "m5 12 4 4L19 6",
  plus: "M12 5v14M5 12h14",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  copy: "M9 9h12v12H9zM15 5V3H3v12h2",
  shield: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm-4 9 3 3 5-6",
  logout: "M15 17l5-5-5-5M20 12H9M12 20H4V4h8",
  spark: "m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
} as const;

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
