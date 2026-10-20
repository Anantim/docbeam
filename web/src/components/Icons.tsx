// The few icons the app uses, drawn the same way: 16 px, a 1.6 stroke, the current text colour. They are always
// decoration: the button or row that holds one carries the label.

interface Props {
  size?: number;
}

function Svg({ size = 16, children }: Props & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const EyeIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
);

export const DownloadIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10" />
  </Svg>
);

export const CopyIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5" />
  </Svg>
);

export const CloseIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
);

export const RetryIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" />
  </Svg>
);

export const FolderIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M2 4.5A1 1 0 0 1 3 3.5h3l1.5 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7.5Z" />
  </Svg>
);

export const ChevronIcon = ({ open, ...p }: Props & { open: boolean }) => (
  <Svg {...p}>
    <path d={open ? 'm4 6 4 4 4-4' : 'm6 4 4 4-4 4'} />
  </Svg>
);

export const UploadIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M8 11.5v-8M4.5 6.5 8 3l3.5 3.5M3 13.5h10" />
  </Svg>
);

export const CheckIcon = (p: Props) => (
  <Svg {...p}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Svg>
);

export const MinusIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 8h8" />
  </Svg>
);

export const SendIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M2.5 8h9M8 4l4 4-4 4" />
  </Svg>
);

export const FileIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M4 2.5h5l3 3v8H4v-11ZM9 2.5v3h3" />
  </Svg>
);

export const LockIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Svg>
);

export const SearchIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4" />
    <path d="m10 10 3.5 3.5" />
  </Svg>
);

export const AlertIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.8v3.8M8 11v.1" />
  </Svg>
);

export const LogoutIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M6.5 3h-3v10h3M9.5 5.5 12 8l-2.5 2.5M12 8H6.5" />
  </Svg>
);
