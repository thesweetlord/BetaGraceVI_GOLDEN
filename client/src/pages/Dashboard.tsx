import { useState } from "react";
import { Link } from "wouter";
import { Separator } from "@/components/ui/separator";
import { 
  SidebarProvider, 
  SidebarTrigger,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { 
  Sparkles,
  Settings,
  Menu,
  Library,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { ChatInterface } from "@/components/ChatInterface";
import { ModeSelector } from "@/components/ModeSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { ArtifactVaultDialog } from "@/components/ArtifactVaultDialog";
import { MODE_METADATA } from "@shared/schema";
import { MODE_COLORS, APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { 
    primaryMode, 
    sidebarOpen,
    setSidebarOpen,
  } = useAppStore();

  const [isVaultOpen, setIsVaultOpen] = useState(false);

  const [mobileDefault] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );

  const modeColors = MODE_COLORS[primaryMode] ?? MODE_COLORS.standard;
  const modeMeta = MODE_METADATA[primaryMode] ?? MODE_METADATA.standard;

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider 
      open={sidebarOpen}
      defaultOpen={mobileDefault && sidebarOpen}
      onOpenChange={setSidebarOpen}
      style={sidebarStyle as React.CSSProperties}
    >
      <div className="flex h-screen w-full">
        <Sidebar>
          <SidebarHeader className="p-4 pb-3">
            <div className="flex items-center gap-2">
              <div className={cn("p-2 rounded-lg shrink-0", modeColors.bg)}>
                <Sparkles className={cn("w-5 h-5", modeColors.text)} />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-semibold text-lg truncate">{APP_NAME}</h1>
                <p className="text-xs text-muted-foreground truncate">
                  vI · Creative Writing AI
                </p>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent className="flex flex-col gap-0 overflow-hidden">
            <ConversationSidebar />
          </SidebarContent>

          <ArtifactVaultDialog
            isOpen={isVaultOpen}
            onClose={() => setIsVaultOpen(false)}
          />

          <SidebarFooter className="border-t px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Link href="/settings">
                  <button
                    title="Settings"
                    className="p-2 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </Link>
                <button
                  title="Artifact Vault"
                  onClick={() => setIsVaultOpen(true)}
                  className="p-2 rounded-md hover:bg-amber-100/60 dark:hover:bg-amber-500/15 transition-colors text-amber-500 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300"
                >
                  <Library className="w-4 h-4" />
                </button>
              </div>
              <ThemeToggle />
            </div>
          </SidebarFooter>
        </Sidebar>

        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 px-4 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle">
                <Menu className="w-5 h-5" />
              </SidebarTrigger>
              <Separator orientation="vertical" className="h-6" />
              <Badge 
                variant="outline" 
                className={cn(modeColors.bg, modeColors.text, "border", modeColors.border)}
              >
                {modeMeta.name} Mode
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <ModeSelector variant="compact" />
            </div>
          </header>

          <main className="flex-1 overflow-hidden">
            <ChatInterface />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
