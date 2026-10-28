import { createElement, Ellipsis, Pencil, Plus, Search, Settings, ArrowUpRight, ChevronLeft, ChevronRight, FileText, Folder, FolderPlus, Sun, Copy, Trash2, Sparkles, TextQuote } from "lucide";

export const MoreIcon = createElement(Ellipsis).outerHTML;
export const EditIcon = createElement(Pencil).outerHTML;
export const AddIcon = createElement(Plus).outerHTML;
export const SearchIcon = createElement(Search).outerHTML;
export const SettingsIcon = createElement(Settings).outerHTML;
export const OpenIcon = createElement(ArrowUpRight).outerHTML;
export const PreviousIcon = createElement(ChevronLeft).outerHTML;
export const NextIcon = createElement(ChevronRight).outerHTML;
export const DocumentIcon = createElement(FileText).outerHTML;
export const FolderIcon = createElement(Folder).outerHTML;
export const FolderAddIcon = createElement(FolderPlus).outerHTML;
export const SignalIcon = createElement(Sparkles).outerHTML;
export const IlluminateIcon = createElement(Sun).outerHTML;
export const CopyIcon = createElement(Copy).outerHTML;
export const TextQuoteIcon = createElement(TextQuote).outerHTML;

// Shared inline SVG icon markup, reused across panels so button glyphs stay consistent.

// A floppy-disk outline, used for save actions.
export const SaveIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l2 2v14H5z"></path><path d="M8 4v6h8V4M8 20v-6h8v6"></path></svg>`;

// An X outline, used for close actions.
export const CloseIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>`;

// A trash-can outline, used for delete actions.
export const TrashIcon = createElement(Trash2).outerHTML;
