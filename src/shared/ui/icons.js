import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import Archive01Icon from "@hugeicons/core-free-icons/Archive01Icon";
import ArchiveRestoreIcon from "@hugeicons/core-free-icons/ArchiveRestoreIcon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import BookOpenTextIcon from "@hugeicons/core-free-icons/BookOpenTextIcon";
import BookCheckIcon from "@hugeicons/core-free-icons/BookCheckIcon";
import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CheckIcon from "@hugeicons/core-free-icons/CheckIcon";
import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon";
import CodeFolderIcon from "@hugeicons/core-free-icons/CodeFolderIcon";
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon";
import ListIcon from "@hugeicons/core-free-icons/ListIcon";
import MessageCircleIcon from "@hugeicons/core-free-icons/MessageCircleIcon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import NotebookTabsIcon from "@hugeicons/core-free-icons/NotebookTabsIcon";
import PinIcon from "@hugeicons/core-free-icons/PinIcon";
import PlugZapIcon from "@hugeicons/core-free-icons/PlugZapIcon";
import RefreshCwIcon from "@hugeicons/core-free-icons/RefreshCwIcon";
import RotateCwIcon from "@hugeicons/core-free-icons/RotateCwIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import Square01Icon from "@hugeicons/core-free-icons/Square01Icon";
import SquarePenIcon from "@hugeicons/core-free-icons/SquarePenIcon";
import Target01Icon from "@hugeicons/core-free-icons/Target01Icon";
import WorkflowSquare01Icon from "@hugeicons/core-free-icons/WorkflowSquare01Icon";
import PaintBrush01Icon from "@hugeicons/core-free-icons/PaintBrush01Icon";

const iconData = {
  archive: Archive01Icon,
  "archive-restore": ArchiveRestoreIcon,
  "arrow-left": ArrowLeft01Icon,
  "arrow-up-right": ArrowUpRight01Icon,
  "book-open-text": BookOpenTextIcon,
  "book-check": BookCheckIcon,
  brain: BrainIcon,
  check: CheckIcon,
  "chevron-down": ChevronDownIcon,
  "chevron-right": ChevronRightIcon,
  copy: Copy01Icon,
  "download-cloud": Download01Icon,
  ellipsis: MoreHorizontalIcon,
  file: File01Icon,
  folder: Folder01Icon,
  "folder-code": CodeFolderIcon,
  "folder-open": FolderOpenIcon,
  "folder-plus": FolderAddIcon,
  "git-branch": GitBranchIcon,
  "circle-question-mark": HelpCircleIcon,
  list: ListIcon,
  "list-checks": CheckListIcon,
  "message-circle": MessageCircleIcon,
  "notebook-tabs": NotebookTabsIcon,
  paintbrush: PaintBrush01Icon,
  pin: PinIcon,
  "plug-zap": PlugZapIcon,
  plus: Add01Icon,
  "refresh-cw": RefreshCwIcon,
  "rotate-cw": RotateCwIcon,
  search: Search01Icon,
  "settings-2": Settings01Icon,
  shield: Shield01Icon,
  square: Square01Icon,
  "square-pen": SquarePenIcon,
  "square-terminal": CommandLineIcon,
  target: Target01Icon,
  workflow: WorkflowSquare01Icon,
  x: Cancel01Icon,
};

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function iconSvg(name, size = 16) {
  const data = iconData[name];
  if (!data) return "";
  const paths = data.map(([tag, attributes]) => {
    const serialized = Object.entries(attributes)
      .filter(([key]) => key !== "key")
      .map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${escapeAttribute(value)}"`)
      .join(" ");
    return `<${tag} ${serialized}/>`;
  }).join("");
  const dimension = Math.max(1, Number(size) || 16);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">${paths}</svg>`;
}
