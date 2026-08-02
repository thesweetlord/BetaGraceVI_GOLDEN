import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Shield, 
  Cross, 
  Skull, 
  Heart, 
  Brain,
  Lock,
  CheckCircle,
  Zap,
  Video,
  Network,
  GraduationCap,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { MODE_METADATA, EXCLUSIVE_MODES, type AIMode } from "@shared/schema";
import { MODE_COLORS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const MODE_ICONS: Record<AIMode, typeof Shield> = {
  standard: Shield,
  flesh_architect: Skull,
  sanctuary: Heart,
  advanced_reasoning: Brain,
  autonomous: Zap,
  video_generator: Video,
  code_graph: Network,
  academic_research: GraduationCap,
};

interface ModeSelectorProps {
  variant?: 'tabs' | 'cards' | 'compact';
  className?: string;
}

export function ModeSelector({ variant = 'tabs', className }: ModeSelectorProps) {
  const { activeModes, primaryMode, toggleMode, setPrimaryMode, canActivateMode } = useAppStore();

  const modes = Object.entries(MODE_METADATA) as [AIMode, typeof MODE_METADATA[AIMode]][];

  if (variant === 'compact') {
    return (
      <div className={cn("flex flex-wrap gap-1", className)}>
        {modes.map(([mode, meta]) => {
          const Icon = MODE_ICONS[mode];
          const isActive = activeModes.includes(mode);
          const isPrimary = primaryMode === mode;
          const canActivate = canActivateMode(mode);
          const colors = MODE_COLORS[mode];

          return (
            <Tooltip key={mode}>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "h-8 px-2 gap-1",
                    isActive && isPrimary && "ring-2 ring-primary ring-offset-2",
                    !canActivate && !isActive && "opacity-50"
                  )}
                  onClick={() => {
                    if (isActive) {
                      setPrimaryMode(mode);
                    } else {
                      toggleMode(mode);
                    }
                  }}
                  disabled={!canActivate && !isActive}
                  data-testid={`button-mode-${mode}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-xs hidden sm:inline">{meta.name}</span>
                  {!canActivate && !isActive && <Lock className="w-3 h-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="font-medium">{meta.name}</p>
                <p className="text-xs text-muted-foreground">{meta.description}</p>
                {meta.isExclusive && (
                  <p className="text-xs text-amber-500 mt-1">
                    Exclusive mode - cannot run with other exclusive modes
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  if (variant === 'tabs') {
    return (
      <div className={cn("border-b border-border", className)}>
        <div className="flex overflow-x-auto scrollbar-hide gap-1 px-2 py-2">
          {modes.map(([mode, meta]) => {
            const Icon = MODE_ICONS[mode];
            const isActive = activeModes.includes(mode);
            const isPrimary = primaryMode === mode;
            const canActivate = canActivateMode(mode);
            const colors = MODE_COLORS[mode];

            return (
              <Tooltip key={mode}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap",
                      "hover-elevate",
                      isActive 
                        ? cn(colors.bg, colors.text, "border", colors.border)
                        : "text-muted-foreground hover:text-foreground",
                      isPrimary && "ring-2 ring-primary/50",
                      !canActivate && !isActive && "opacity-40 cursor-not-allowed"
                    )}
                    onClick={() => {
                      if (!canActivate && !isActive) return;
                      if (isActive) {
                        setPrimaryMode(mode);
                      } else {
                        toggleMode(mode);
                      }
                    }}
                    data-testid={`tab-mode-${mode}`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{meta.name}</span>
                    {isActive && (
                      <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    )}
                    {meta.isExclusive && !isActive && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                        Exclusive
                      </Badge>
                    )}
                    {!canActivate && !isActive && (
                      <Lock className="w-3.5 h-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="font-medium">{meta.name}</p>
                  <p className="text-xs text-muted-foreground">{meta.description}</p>
                  <p className="text-xs text-primary mt-1">Command: {meta.command}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    );
  }

  // Cards variant
  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4", className)}>
      {modes.map(([mode, meta]) => {
        const Icon = MODE_ICONS[mode];
        const isActive = activeModes.includes(mode);
        const isPrimary = primaryMode === mode;
        const canActivate = canActivateMode(mode);
        const colors = MODE_COLORS[mode];

        return (
          <Card
            key={mode}
            className={cn(
              "cursor-pointer transition-all hover-elevate",
              isActive && cn(colors.bg, "border-2", colors.border),
              isPrimary && "ring-2 ring-primary",
              !canActivate && !isActive && "opacity-50 cursor-not-allowed"
            )}
            onClick={() => {
              if (!canActivate && !isActive) return;
              if (isActive) {
                setPrimaryMode(mode);
              } else {
                toggleMode(mode);
              }
            }}
            data-testid={`card-mode-${mode}`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={cn("p-2 rounded-lg", colors.bg)}>
                    <Icon className={cn("w-5 h-5", colors.text)} />
                  </div>
                  <CardTitle className="text-base">{meta.name}</CardTitle>
                </div>
                <div className="flex items-center gap-1">
                  {isActive && (
                    <Badge variant="default" className="text-[10px] h-5">
                      <Zap className="w-3 h-3 mr-1" />
                      Active
                    </Badge>
                  )}
                  {meta.isExclusive && (
                    <Badge variant="outline" className="text-[10px] h-5">
                      Exclusive
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-xs">
                {meta.description}
              </CardDescription>
              <p className="text-xs text-muted-foreground mt-2 font-mono">
                Command: {meta.command}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
