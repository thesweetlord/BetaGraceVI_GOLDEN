import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AIMode, Session, Message, Consent } from '@shared/schema';
import { EXCLUSIVE_MODES, MODE_DEPENDENCIES, MODE_CONFLICTS } from '@shared/schema';
import { validateMode, validateModes, sanitizeMode, ensureSingleMode } from '@/lib/modeValidator';

interface AppState {
  // Session state - PERSISTENT via localStorage
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  session: Session | null;
  setSession: (session: Session | null) => void;
  
  // Age verification (18+ required)
  ageVerified: boolean;
  isOver18: boolean | null;
  setAgeVerification: (verified: boolean, isOver18: boolean | null) => void;
  
  // Cookie consent
  showCookieConsent: boolean;
  setShowCookieConsent: (show: boolean) => void;
  consent: Consent | null;
  setConsent: (consent: Consent | null) => void;
  
  // Mode management
  activeModes: AIMode[];
  primaryMode: AIMode;
  setActiveModes: (modes: AIMode[]) => void;
  toggleMode: (mode: AIMode) => void;
  setPrimaryMode: (mode: AIMode) => void;
  canActivateMode: (mode: AIMode) => boolean;
  
  // Messages
  messages: Message[];
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  updateMessageContent: (id: string, content: string) => void;
  clearMessages: () => void;
  rollbackToMessage: (messageId: string) => void;
  
  // Generated images - PERSISTENT for conversation continuity
  generatedImage: string | null;
  setGeneratedImage: (url: string | null) => void;
  generatedVideo: string | null;
  setGeneratedVideo: (url: string | null) => void;
  generatedStoryboard: string[] | null;
  setGeneratedStoryboard: (frames: string[] | null) => void;
  generatedStoryboardCaptions: string[] | null;
  setGeneratedStoryboardCaptions: (captions: string[] | null) => void;
  baseImagePrompt: string | null;
  setBaseImagePrompt: (prompt: string | null) => void;
  
  // Conversations
  currentConversationId: string | null;
  setCurrentConversationId: (id: string | null) => void;
  
  // UI state
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  
  // Theme
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  
  // Data retention
  dataRetentionOptOut: boolean;
  setDataRetentionOptOut: (optOut: boolean) => void;
  
  // Parallel learning
  learningEnabled: boolean;
  setLearningEnabled: (enabled: boolean) => void;
  
  // Advanced Reasoning Enhancement (ON by default, applies to all modes)
  advancedReasoningEnabled: boolean;
  setAdvancedReasoningEnabled: (enabled: boolean) => void;
  
  // Faith Enhancement (OFF by default, applies to all modes)
  faithEnhancementEnabled: boolean;
  setFaithEnhancementEnabled: (enabled: boolean) => void;
  
  // Model selection (Pollinations)
  textModel: string;
  setTextModel: (model: string) => void;
  imageModel: string;
  setImageModel: (model: string) => void;

  // Flux base style for advanced image generation
  baseStyleId: string | null;
  setBaseStyleId: (id: string | null) => void;
  baseStylePrompt: string | null;
  setBaseStylePrompt: (prompt: string | null) => void;
  useFluxBaseForGeneration: boolean;
  setUseFluxBaseForGeneration: (enabled: boolean) => void;

  // NSFW mode toggle
  nsfwEnabled: boolean;
  setNsfwEnabled: (enabled: boolean) => void;

  // Per-request token ceiling — persisted across reloads and tabs
  maxTokens: number;
  setMaxTokens: (n: number) => void;

  // Reset all data
  resetAllData: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Session - PERSISTENT via X-Session-ID header
      sessionId: null,
      setSessionId: (id) => set({ sessionId: id }),
      session: null,
      setSession: (session) => set({ session }),
      
      // Age verification (18+ required)
      ageVerified: false,
      isOver18: null,
      setAgeVerification: (verified, isOver18) => set({ 
        ageVerified: verified, 
        isOver18 
      }),
      
      // Cookie consent
      showCookieConsent: true,
      setShowCookieConsent: (show) => set({ showCookieConsent: show }),
      consent: null,
      setConsent: (consent) => {
        set({ consent, showCookieConsent: false });
        
        // Save to backend asynchronously
        if (consent && consent.sessionId) {
          fetch('/api/consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(consent)
          }).catch(err => console.error('[CONSENT SYNC]:', err));
        }
      },
      
      // Mode management
      activeModes: ['standard'],
      primaryMode: 'standard',
      setActiveModes: (modes) => set({ activeModes: modes }),
      toggleMode: (mode) => {
        // SECURITY: Validate mode before any processing
        if (!validateMode(mode)) {
          console.error('[SECURITY] Invalid mode attempted:', mode);
          return;
        }

        const { activeModes } = get();
        const isActive = activeModes.includes(mode);

        if (isActive) {
          // Can't deactivate the last mode - keep Standard as fallback
          if (activeModes.length === 1) {
            set({ activeModes: ['standard'], primaryMode: 'standard' });
            return;
          }
          // Deactivate this mode
          const newModes = activeModes.filter(m => m !== mode);
          set({ 
            activeModes: newModes,
            primaryMode: newModes[0] || 'standard'
          });
        } else {
          // CRITICAL: ALL MODES ARE MUTUALLY EXCLUSIVE
          // Activating a mode deactivates all others
          set({ 
            activeModes: [mode],
            primaryMode: mode
          });
        }
      },
      setPrimaryMode: (mode) => {
        // SECURITY: Validate mode before setting
        if (!validateMode(mode)) {
          console.error('[SECURITY] Invalid primary mode attempted:', mode);
          return;
        }

        const { activeModes } = get();
        if (activeModes.includes(mode)) {
          set({ primaryMode: mode });
        }
      },
      canActivateMode: (mode) => {
        // SECURITY: Validate mode
        if (!validateMode(mode)) {
          console.error('[SECURITY] Invalid mode in canActivateMode:', mode);
          return false;
        }
        
        // All modes can always be activated (they deactivate others)
        return true;
      },
      
      // Messages
      messages: [],
      addMessage: (message) => set((state) => {
        // Guard against null/undefined mode to prevent rendering bugs
        const safeMessage = {
          ...message,
          mode: message.mode || state.primaryMode || 'standard',
        };
        return { messages: [...state.messages, safeMessage] };
      }),
      setMessages: (messages) => set({ messages }),
      updateMessageContent: (id, content) => set((state) => ({
        messages: state.messages.map(m => m.id === id ? { ...m, content } : m),
      })),
      clearMessages: () => set({ messages: [] }),
      rollbackToMessage: (messageId) => set((state) => {
        const idx = state.messages.findIndex((m) => m.id === messageId);
        if (idx === -1) return {};
        // Keep messages up to and including the target message
        const trimmed = state.messages.slice(0, idx + 1);
        return {
          messages: trimmed,
          // Clear any generated media that came after this point
          generatedImage: null,
          generatedVideo: null,
          generatedStoryboard: null,
          baseImagePrompt: null,
        };
      }),
      
      // Generated images
      generatedImage: null,
      setGeneratedImage: (url) => set({ generatedImage: url }),
      generatedVideo: null,
      setGeneratedVideo: (url) => set({ generatedVideo: url }),
      generatedStoryboard: null,
      setGeneratedStoryboard: (frames) => set({ generatedStoryboard: frames }),
      generatedStoryboardCaptions: null,
      setGeneratedStoryboardCaptions: (captions) => set({ generatedStoryboardCaptions: captions }),
      baseImagePrompt: null,
      setBaseImagePrompt: (prompt) => set({ baseImagePrompt: prompt }),
      
      // Conversations
      currentConversationId: null,
      setCurrentConversationId: (id) => set({ currentConversationId: id }),
      
      // UI
      sidebarOpen: typeof window !== "undefined" ? window.innerWidth >= 768 : true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      
      // Theme
      theme: 'system',
      setTheme: (theme) => {
        set({ theme });
        const root = document.documentElement;
        if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      },
      
      // Data retention
      dataRetentionOptOut: false,
      setDataRetentionOptOut: (optOut) => set({ dataRetentionOptOut: optOut }),
      
      // Parallel learning
      learningEnabled: true,
      setLearningEnabled: (enabled) => set({ learningEnabled: enabled }),
      
      // Advanced Reasoning Enhancement (ON by default)
      advancedReasoningEnabled: true,
      setAdvancedReasoningEnabled: (enabled) => set({ advancedReasoningEnabled: enabled }),
      
      // Faith Enhancement (OFF by default, can enhance any mode)
      faithEnhancementEnabled: false,
      setFaithEnhancementEnabled: (enabled) => set({ faithEnhancementEnabled: enabled }),

      // Model selection (Pollinations)
      textModel: 'openai',
      setTextModel: (model) => set({ textModel: model }),
      imageModel: 'flux',
      setImageModel: (model) => set({ imageModel: model }),

      // Flux base style for advanced image generation
      baseStyleId: null,
      setBaseStyleId: (id) => set({ baseStyleId: id }),
      baseStylePrompt: null,
      setBaseStylePrompt: (prompt) => set({ baseStylePrompt: prompt }),
      useFluxBaseForGeneration: false,
      setUseFluxBaseForGeneration: (enabled) => set({ useFluxBaseForGeneration: enabled }),

      // NSFW mode toggle
      nsfwEnabled: false,
      setNsfwEnabled: (enabled) => set({ nsfwEnabled: enabled }),

      // Per-request token ceiling — persisted across reloads and tabs
      maxTokens: 32768,
      setMaxTokens: (n) => set({ maxTokens: n }),

      // Reset all data
      resetAllData: () => set({
        sessionId: null,
        session: null,
        ageVerified: false,
        isOver18: null,
        showCookieConsent: true,
        consent: null,
        activeModes: ['standard'],
        primaryMode: 'standard',
        messages: [],
        generatedImage: null,
        generatedVideo: null,
        generatedStoryboard: null,
        generatedStoryboardCaptions: null,
        baseImagePrompt: null,
        currentConversationId: null,
        dataRetentionOptOut: false,
        learningEnabled: true,
        advancedReasoningEnabled: true,
        faithEnhancementEnabled: false,
        textModel: 'openai',
        imageModel: 'flux',
        baseStyleId: null,
        baseStylePrompt: null,
        useFluxBaseForGeneration: false,
        nsfwEnabled: false,
        maxTokens: 32768,
      }),
    }),
    {
      name: 'betagrace-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // CRITICAL: Persist sessionId for X-Session-ID header persistence
        sessionId: state.sessionId,
        // CRITICAL: Persist ageVerified to prevent re-verification on page reload
        // Users verify once per session, not on every reload
        ageVerified: state.ageVerified,
        isOver18: state.isOver18,
        // CRITICAL: Persist chat messages and conversation for continuity
        messages: state.messages,
        generatedImage: state.generatedImage,
        generatedVideo: state.generatedVideo,
        baseImagePrompt: state.baseImagePrompt,
        currentConversationId: state.currentConversationId,
        // CRITICAL: Persist user preferences
        consent: state.consent,
        showCookieConsent: state.showCookieConsent,
        theme: state.theme,
        dataRetentionOptOut: state.dataRetentionOptOut,
        learningEnabled: state.learningEnabled,
        advancedReasoningEnabled: state.advancedReasoningEnabled,
        faithEnhancementEnabled: state.faithEnhancementEnabled,
        textModel: state.textModel,
        imageModel: state.imageModel,
        sidebarOpen: state.sidebarOpen,
        activeModes: state.activeModes,
        primaryMode: state.primaryMode,
        maxTokens: state.maxTokens,
        nsfwEnabled: state.nsfwEnabled,
      }),
    }
  )
);

// Initialize theme on load and sanitize persisted mode state
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('betagrace-storage');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const theme = parsed?.state?.theme || 'system';
      const root = document.documentElement;
      if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        root.classList.add('dark');
      }

      const persistedState = parsed?.state;
      const activeModes = validateModes(persistedState?.activeModes) ? persistedState.activeModes : ['standard'];
      const primaryMode = validateMode(persistedState?.primaryMode) && activeModes.includes(persistedState.primaryMode)
        ? persistedState.primaryMode
        : activeModes[0] ?? 'standard';

      if (
        !validateModes(persistedState?.activeModes) ||
        !validateMode(persistedState?.primaryMode) ||
        !activeModes.includes(persistedState?.primaryMode)
      ) {
        localStorage.setItem(
          'betagrace-storage',
          JSON.stringify({
            ...parsed,
            state: {
              ...persistedState,
              activeModes,
              primaryMode,
            },
          }),
        );
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
}
