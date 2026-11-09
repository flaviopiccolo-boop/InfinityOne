import { useId, useRef } from "react";

const icons = {
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  add: <path d="M12 5v14M5 12h14"/>,
  next: <path d="m6 5 10 7-10 7zM18 5v14"/>,
  queue: <path d="M4 6h16M4 12h16M4 18h8m6-3v6m-3-3h6"/>,
  playlist: <path d="M4 6h16M4 12h10M4 18h6m8-6v8m-4-4h8"/>,
  track: <path d="M10 17V6l9-2v11M10 17c0 1-1 2-3 2s-3-1-3-2 1-2 3-2 3 1 3 2zm9-2c0 1-1 2-3 2s-3-1-3-2 1-2 3-2 3 1 3 2z"/>,
  remove: <path d="M5 12h14"/>,
  delete: <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>,
};

type MenuAction = {
  id: string;
  icon: keyof typeof icons;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
};

type ActionMenuProps = {
  label: string;
  icon: "more" | "add";
  disabled?: boolean;
  groups: { label?: string; actions: MenuAction[] }[];
};

function ActionIcon({ name }: { name: keyof typeof icons }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{icons[name]}</svg>;
}

export default function ActionMenu({ label, icon, disabled, groups }: ActionMenuProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  return (
    <>
      <button ref={trigger} className={`action-trigger action-trigger-${icon}`} type="button"
        aria-label={label} title={label} disabled={disabled} popoverTarget={id}>
        <ActionIcon name={icon} />
      </button>
      <div ref={panel} id={id} className="action-popover" popover="auto" role="group" aria-label={label}>
        {groups.map((group) => (
          <div className="action-group" key={group.label ?? "actions"}>
            {group.label && <p>{group.label}</p>}
            {group.actions.map((action) => (
              <button type="button" className="action-option" key={action.id} disabled={action.disabled}
                onClick={() => {
                  panel.current?.hidePopover();
                  trigger.current?.focus();
                  action.onSelect();
                }}>
                <ActionIcon name={action.icon} />
                <span className="truncate" title={action.label}>{action.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
