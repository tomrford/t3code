import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { memo, useCallback, useState } from "react";

import { cn } from "../lib/utils";
import { devspaceEnvironment } from "../state/devspace";
import { useEnvironmentQuery } from "../state/query";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";

const DEFAULT_DEVSPACE_REV = "trunk()";

interface BranchToolbarDevspaceRevisionSelectorProps {
  className?: string;
  environmentId: EnvironmentId;
  repo: string;
  value?: string | null;
  onValueChange: (rev: string) => void;
  onComposerFocusRequest?: () => void;
}

export const BranchToolbarDevspaceRevisionSelector = memo(
  function BranchToolbarDevspaceRevisionSelector({
    className,
    environmentId,
    repo,
    value,
    onValueChange,
    onComposerFocusRequest,
  }: BranchToolbarDevspaceRevisionSelectorProps) {
    const [open, setOpen] = useState(false);
    const [customRev, setCustomRev] = useState("");
    const selectedRev = value?.trim() || DEFAULT_DEVSPACE_REV;
    const refsQuery = useEnvironmentQuery(
      devspaceEnvironment.refs({
        environmentId,
        input: { repo },
      }),
    );
    const bookmarks = refsQuery.data?.bookmarks ?? [];
    const workspaceHeads = refsQuery.data?.workspaceHeads ?? [];
    const triggerLabel = selectedRev === DEFAULT_DEVSPACE_REV ? "trunk (default)" : selectedRev;

    const selectRev = useCallback(
      (nextRev: string) => {
        const trimmedRev = nextRev.trim();
        if (trimmedRev.length === 0) return;
        onValueChange(trimmedRev);
        setCustomRev("");
        setOpen(false);
        onComposerFocusRequest?.();
      },
      [onComposerFocusRequest, onValueChange],
    );

    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (nextOpen) {
          refsQuery.refresh();
        } else {
          setCustomRev("");
        }
      },
      [refsQuery],
    );

    return (
      <Menu open={open} onOpenChange={handleOpenChange}>
        <MenuTrigger
          render={<Button variant="ghost" size="xs" />}
          className={cn("min-w-0 text-muted-foreground/70 hover:text-foreground/80", className)}
        >
          <GitBranchIcon className="size-3 shrink-0 opacity-70" />
          <span className="min-w-0 max-w-[240px] truncate">{triggerLabel}</span>
          <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
        </MenuTrigger>
        <MenuPopup align="end" side="top" className="w-72">
          <MenuRadioGroup value={selectedRev} onValueChange={selectRev}>
            <MenuGroup>
              <MenuRadioItem value={DEFAULT_DEVSPACE_REV}>trunk (default)</MenuRadioItem>
            </MenuGroup>
            {bookmarks.length > 0 ? (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>Bookmarks</MenuGroupLabel>
                  {bookmarks.map((bookmark) => (
                    <MenuRadioItem key={bookmark} value={bookmark}>
                      <span className="min-w-0 truncate">{bookmark}</span>
                    </MenuRadioItem>
                  ))}
                </MenuGroup>
              </>
            ) : null}
            {workspaceHeads.length > 0 ? (
              <>
                <MenuSeparator />
                <MenuGroup>
                  <MenuGroupLabel>Workspace heads</MenuGroupLabel>
                  {workspaceHeads.map((workspaceHead) => (
                    <MenuRadioItem key={workspaceHead} value={workspaceHead}>
                      <span className="min-w-0 truncate">{workspaceHead}</span>
                    </MenuRadioItem>
                  ))}
                </MenuGroup>
              </>
            ) : null}
          </MenuRadioGroup>
          <MenuSeparator />
          <form
            className="flex items-center gap-1.5 px-1 py-1"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              selectRev(customRev);
            }}
          >
            <Input
              className="h-7 min-w-0 flex-1 text-xs"
              placeholder="change ID or revset..."
              value={customRev}
              onChange={(event) => setCustomRev(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <Button type="submit" size="xs" variant="secondary" disabled={!customRev.trim()}>
              Use
            </Button>
          </form>
          {refsQuery.isPending ? (
            <div className="px-2 py-1 text-muted-foreground text-xs">Loading refs...</div>
          ) : refsQuery.error ? (
            <div className="px-2 py-1 text-destructive text-xs">{refsQuery.error}</div>
          ) : null}
        </MenuPopup>
      </Menu>
    );
  },
);

export { DEFAULT_DEVSPACE_REV };
