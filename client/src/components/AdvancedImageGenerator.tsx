import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface AdvancedImageResult {
  success: boolean;
  type: 'text-to-image' | 'image-to-image';
  prompt?: string;
  style: string;
  strength?: number;
  seed: number;
  width: number;
  height: number;
  imageUrl: string;
  originalImageURL?: string;
}

interface AdvancedImageGeneratorProps {
  initialStyle?: string;
}

export function AdvancedImageGenerator({ initialStyle }: AdvancedImageGeneratorProps) {
  const [prompt, setPrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(initialStyle || 'photo');
  const [strength, setStrength] = useState(0.7);
  const [result, setResult] = useState<AdvancedImageResult | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);
  const { toast } = useToast();
  const { baseImagePrompt, generatedImage } = useAppStore();

  const { data: stylesData } = useQuery({
    queryKey: ['advanced-image-styles'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/advanced-image/styles');
      return await response.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const styles = useMemo(() => stylesData?.styles || [], [stylesData?.styles]);
  const strengthPresets = useMemo(() => stylesData?.strengthPresets || {
    subtle: 0.3,
    balanced: 0.7,
    creative: 0.9
  }, [stylesData?.strengthPresets]);

  useEffect(() => {
    if (initialStyle && initialStyle !== selectedStyle) {
      setSelectedStyle(initialStyle);
    }
  }, [initialStyle, selectedStyle]);

  const textToImageMutation = useMutation({
    mutationFn: async (data: { prompt: string; style: string }) => {
      const baseImage = generatedImage || baseImagePrompt || undefined;
      const payload: any = { prompt: data.prompt, style: data.style };
      if (baseImage) payload.imageURL = baseImage;
      console.log('[AdvancedImageGenerator] textToImageMutation sending payload:', payload);
      const response = await apiRequest('POST', '/api/advanced-image/text-to-image', payload);
      return await response.json();
    },
    onSuccess: (data) => {
      const imageUrl = data.imageUrl.startsWith('https://gen.pollinations.ai/')
        ? `/api/proxy-image?url=${encodeURIComponent(data.imageUrl)}&v=${Date.now()}`
        : `${data.imageUrl}${data.imageUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
      setResult({ ...data, imageUrl });
      toast({
        title: 'Image Generated',
        description: `Generated ${data.style} image successfully`
      });
    },
    onError: (error) => {
      console.error('[AdvancedImageGenerator] textToImageMutation error:', error);
      toast({
        title: 'Generation Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    }
  });

  const imageToImageMutation = useMutation({
    mutationFn: async (data: { imageURL: string; style: string; strength: number }) => {
      const payload: any = { imageURL: data.imageURL, style: data.style, strength: data.strength };
      const response = await apiRequest('POST', '/api/advanced-image/image-to-image', payload);
      return await response.json();
    },
    onSuccess: (data) => {
      const imageUrl = data.imageUrl.startsWith('https://gen.pollinations.ai/')
        ? `/api/proxy-image?url=${encodeURIComponent(data.imageUrl)}&v=${Date.now()}`
        : `${data.imageUrl}${data.imageUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
      setResult({ ...data, imageUrl });
      toast({
        title: 'Image Regenerated',
        description: `Regenerated with ${data.style} style at ${Math.round(data.strength * 100)}% strength`
      });
    },
    onError: (error) => {
      toast({
        title: 'Regeneration Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    }
  });

  const handleGenerateFromText = useCallback(() => {
    if (!prompt.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a prompt',
        variant: 'destructive'
      });
      return;
    }

    const trimmedPrompt = prompt.trim();
    textToImageMutation.mutate({ prompt: trimmedPrompt, style: selectedStyle });
  }, [prompt, selectedStyle, toast, textToImageMutation]);

  const handleRegenerateWithStyle = useCallback((newStyle: string) => {
    if (!result) return;
    const imageToUse = generatedImage || baseImagePrompt || result.originalImageURL;
    if (imageToUse) {
      imageToImageMutation.mutate({
        imageURL: imageToUse,
        style: newStyle,
        strength: result.strength || 0.7
      });
    }
  }, [result, generatedImage, baseImagePrompt, imageToImageMutation]);

  const handleStrengthPreset = useCallback((preset: string) => {
    const presetValue = strengthPresets[preset as keyof typeof strengthPresets];
    if (presetValue) {
      setStrength(presetValue);
      if (result && result.type === 'image-to-image' && result.originalImageURL) {
        imageToImageMutation.mutate({
          imageURL: result.originalImageURL,
          style: result.style,
          strength: presetValue
        });
      }
    }
  }, [strengthPresets, result, imageToImageMutation]);

  const isLoading = textToImageMutation.isPending || imageToImageMutation.isPending;

  return (
    <div className="w-full space-y-4 p-4 border rounded-lg bg-slate-50 dark:bg-slate-900">
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Advanced Image Generator (Base Style: Flux)</h3>
        <p className="text-xs text-muted-foreground">Full resolution with advanced styling</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image you want to generate..."
          className="w-full min-h-20 p-2 text-xs border rounded resize-none bg-white dark:bg-slate-800 text-black dark:text-white"
          disabled={isLoading}
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium">Style</label>
        <select
          value={selectedStyle}
          onChange={(e) => setSelectedStyle(e.target.value)}
          className="w-full p-2 text-xs border rounded bg-white dark:bg-slate-800 text-black dark:text-white"
          disabled={isLoading}
        >
          {styles.map((style: { id: string; name: string }) => (
            <option key={style.id} value={style.id}>
              {style.name}
            </option>
          ))}
        </select>
      </div>

      {result?.type === 'image-to-image' && (
        <div className="space-y-2">
          <label className="text-xs font-medium">Strength: {Math.round(strength * 100)}%</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={strength}
            onChange={(e) => setStrength(parseFloat(e.target.value))}
            className="w-full"
            disabled={isLoading}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="text-xs" onClick={() => handleStrengthPreset('subtle')} disabled={isLoading}>Subtle</Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => handleStrengthPreset('balanced')} disabled={isLoading}>Balanced</Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => handleStrengthPreset('creative')} disabled={isLoading}>Creative</Button>
          </div>
        </div>
      )}

      <Button
        onClick={handleGenerateFromText}
        disabled={isLoading || !prompt.trim()}
        className="w-full text-xs"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Generating...
          </>
        ) : (
          'Generate Image'
        )}
      </Button>

      {result && (
        <div className="space-y-2">
          <div className="relative rounded border overflow-hidden bg-gray-100 dark:bg-slate-800">
            {isPreloading && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-slate-800 z-10">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            )}
            <img
              src={result.imageUrl}
              alt={`Generated ${result.style}`}
              className="w-full rounded transition-opacity duration-300"
              loading="lazy"
              onLoad={() => setIsPreloading(false)}
              onError={(e) => {
                setIsPreloading(false);
                const img = e.currentTarget as HTMLImageElement | null;
                const src = img?.src ?? '(unknown)';
                console.error('[AdvancedImageGenerator] Image load failed for src:', src);
              }}
            />
          </div>
          <div className="text-xs space-y-1 p-2 bg-white dark:bg-slate-800 rounded border">
            <p><strong>Type:</strong> {result.type}</p>
            <p><strong>Style:</strong> {result.style}</p>
            {result.prompt && <p><strong>Prompt:</strong> {result.prompt}</p>}
            {result.strength !== undefined && <p><strong>Strength:</strong> {Math.round(result.strength * 100)}%</p>}
            <p><strong>Seed:</strong> {result.seed}</p>
            <p><strong>Resolution:</strong> {result.width}x{result.height}</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium">Quick Restyle:</p>
            <div className="grid grid-cols-2 gap-2">
              {styles.slice(0, 6).map((style: { id: string; name: string }) => (
                <Button
                  key={style.id}
                  size="sm"
                  variant={selectedStyle === style.id ? 'default' : 'outline'}
                  className="text-xs"
                  onClick={() => {
                    setSelectedStyle(style.id);
                    if (result.type === 'image-to-image' && result.originalImageURL) {
                      handleRegenerateWithStyle(style.id);
                    }
                  }}
                  disabled={isLoading}
                >
                  {style.name}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
