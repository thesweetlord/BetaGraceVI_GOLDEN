declare module "esbuild" {
  export function build(options: any): Promise<any>;
}

declare module "vite" {
  export function build(options?: any): Promise<any>;
  export function createServer(options?: any): Promise<any>;
  export function createLogger(level?: string, options?: any): {
    hasWarned: boolean;
    info(msg: string, options?: any): void;
    warn(msg: string, options?: any): void;
    warnOnce(msg: string, options?: any): void;
    error(msg: string, options?: any): void;
    clearScreen(type?: string): void;
    hasErrorLogged?(error: any): boolean;
  };
  export function defineConfig(config: any): any;
}

declare module "@vitejs/plugin-react" {
  export default function react(options?: any): any;
}

declare module "ffmpeg-static" {
  const ffmpegPath: string | null;
  export default ffmpegPath;
}

declare module "drizzle-orm" {
  export function eq(...args: any[]): any;
  export function desc(...args: any[]): any;
  export function asc(...args: any[]): any;
  export function sql(...args: any[]): any;
}
