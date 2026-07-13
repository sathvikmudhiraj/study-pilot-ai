export type IconProps = React.SVGAttributes<SVGElement> & {
  size?: number;
};

function Icon({ size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function IconDashboard({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Icon>
  );
}

export function IconUpload({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </Icon>
  );
}

export function IconFiles({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </Icon>
  );
}

export function IconChat({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Icon>
  );
}

export function IconMic({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </Icon>
  );
}

export function IconSummarize({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="8" y2="18" />
      <line x1="12" y1="14" x2="8" y2="14" />
      <line x1="16" y1="10" x2="8" y2="10" />
    </Icon>
  );
}

export function IconQuiz({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </Icon>
  );
}

export function IconRevision({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </Icon>
  );
}

export function IconSignOut({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </Icon>
  );
}

export function IconMenu({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </Icon>
  );
}

export function IconX({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Icon>
  );
}

export function IconSend({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </Icon>
  );
}

export function IconPlus({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Icon>
  );
}

export function IconCopy({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Icon>
  );
}

export function IconVolume({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </Icon>
  );
}

export function IconVolumeOff({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </Icon>
  );
}

export function IconCheck({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <polyline points="20 6 9 17 4 12" />
    </Icon>
  );
}

export function IconChevronLeft({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <polyline points="15 18 9 12 15 6" />
    </Icon>
  );
}

export function IconChevronRight({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <polyline points="9 18 15 12 9 6" />
    </Icon>
  );
}

export function IconSparkles({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M12 2L14.09 8.26L20.18 9.27L15.54 13.14L16.91 19.02L12 16.27L7.09 19.02L8.46 13.14L3.82 9.27L9.91 8.26L12 2Z" />
    </Icon>
  );
}

export function IconBrain({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M12 2C8 2 6 5 6 7c0 .5 0 1 .1 1.4C4.3 9.1 3 10.8 3 13c0 2 1 3.5 2.5 4.1C5 18 5.5 19 6.5 19.5c0 0 2 .5 5.5.5s5.5-.5 5.5-.5c1-.5 1.5-1.5 1-2.4C20 16.5 21 15 21 13c0-2.2-1.3-3.9-3.1-4.6.1-.4.1-.9.1-1.4 0-2-2-5-6-5z" />
      <path d="M9 10h0" />
      <path d="M15 10h0" />
      <path d="M9 14h0" />
      <path d="M15 14h0" />
    </Icon>
  );
}

export function IconSearch({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Icon>
  );
}

export function IconSettings({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
  );
}

export function IconShield({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </Icon>
  );
}

export function IconAdmin({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
    </Icon>
  );
}

export function IconImage({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </Icon>
  );
}

export function IconFileText({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </Icon>
  );
}

export function IconRefresh({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </Icon>
  );
}

export function IconPlay({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </Icon>
  );
}

export function IconPause({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </Icon>
  );
}

export function IconTarget({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </Icon>
  );
}

export function IconCalendar({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </Icon>
  );
}

export function IconClock({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </Icon>
  );
}

export function IconZap({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </Icon>
  );
}

export function IconThumbsUp({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </Icon>
  );
}

export function IconThumbsDown({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </Icon>
  );
}

export function IconStop({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </Icon>
  );
}

export function IconArrowDown({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </Icon>
  );
}

export function IconTrash({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </Icon>
  );
}

export function IconChevronDown({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <polyline points="6 9 12 15 18 9" />
    </Icon>
  );
}

export function IconBookOpen({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </Icon>
  );
}

export function IconPin({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14l-1.5-2.5V9a3 3 0 0 0-3-3h-5a3 3 0 0 0-3 3v5.5L5 17z" />
    </Icon>
  );
}

export function IconEdit({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </Icon>
  );
}

export function IconMoreHorizontal({ size, ...props }: IconProps) {
  return (
    <Icon size={size} {...props}>
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Icon>
  );
}
