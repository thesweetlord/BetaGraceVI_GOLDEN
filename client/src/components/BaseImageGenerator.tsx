import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Loader2, Download } from 'lucide-react';
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
  loraWeight?: number;
  negativeBoost?: string;
}

interface AdvancedImageGeneratorProps {
  initialStyle?: string;
}

export function BaseImageGenerator({ initialStyle }: AdvancedImageGeneratorProps) {
  const [prompt, setPrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(initialStyle || 'photo');
  const [strength, setStrength] = useState(0.7);
  const [result, setResult] = useState<AdvancedImageResult | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);
  const { toast } = useToast();
  const { baseImagePrompt, generatedImage, baseStyleId, baseStylePrompt, useFluxBaseForGeneration, nsfwEnabled } = useAppStore();

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
      if (nsfwEnabled) {
        console.log('[BaseImageGenerator] NSFW mode enabled - routing to /api/generate-nsfw-image');
        const response = await apiRequest('POST', '/api/generate-nsfw-image', {
          prompt: data.prompt,
        });
        const nsfwResult = await response.json();
        return {
          ...nsfwResult,
          style: 'nsfw',
          type: 'text-to-image',
          width: 1024,
          height: 1024,
          seed: 0,
        };
      }

      const baseImage = generatedImage || baseImagePrompt || undefined;
      const payload: any = { prompt: data.prompt, style: data.style };
      if (useFluxBaseForGeneration && baseStyleId && String(baseStyleId).toLowerCase() === 'flux') {
        payload.baseStyleId = 'flux';
        const derivedBasePrompt = (data.prompt && String(data.prompt).trim().length > 0) ? String(data.prompt).trim() : (baseStylePrompt ? String(baseStylePrompt).trim() : undefined);
        if (derivedBasePrompt) payload.baseStylePrompt = derivedBasePrompt;
      }
      if (baseImage) {
        try {
          new URL(baseImage);
          payload.imageURL = baseImage;
        } catch (e) {
          console.warn('[BaseImageGenerator] baseImagePrompt is not a URL; skipping imageURL in payload:', baseImage);
        }
      }
      const response = await apiRequest('POST', '/api/advanced-image/text-to-image', payload);
      return await response.json();
    },
    onSuccess: (data: any) => {
      let finalData = data;
      try {
        if (data?.imageUrl && typeof data.imageUrl === 'string') {
          const u = new URL(data.imageUrl);
          const host = u.hostname.toLowerCase();
          const proxiedHosts = ['image.pollinations.ai', 'gen.pollinations.ai', 'pollinations.ai', 'images.pollinations.ai', '.r2.cloudflarestorage.com'];
          const shouldProxy = proxiedHosts.some(s => host === s || host.endsWith(s));
          if (shouldProxy) {
            const proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(data.imageUrl)}`;
            finalData = { ...data, imageUrl: `${proxiedUrl}&v=${Date.now()}` };
          } else {
            finalData = { ...data, imageUrl: `${data.imageUrl}${data.imageUrl.includes('?') ? '&' : '?'}v=${Date.now()}` };
          }
        }
      } catch (e) {
        // ignore and use original data
      }
      setResult(finalData);
      toast({
        title: 'Image Generated',
        description: `Generated ${finalData.style} image successfully`
      });
    },
    onError: (error: any) => {
      console.error('[BaseImageGenerator] textToImageMutation error:', error);
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
      if (useFluxBaseForGeneration && baseStyleId && String(baseStyleId).toLowerCase() === 'flux') {
        payload.baseStyleId = 'flux';
        if (baseStylePrompt && String(baseStylePrompt).trim().length > 0) payload.baseStylePrompt = String(baseStylePrompt).trim();
      }
      const response = await apiRequest('POST', '/api/advanced-image/image-to-image', payload);
      return await response.json();
    },
    onSuccess: (data: any) => {
      let finalData = data;
      try {
        if (data?.imageUrl && typeof data.imageUrl === 'string') {
          const u = new URL(data.imageUrl);
          const host = u.hostname.toLowerCase();
          const proxiedHosts = ['image.pollinations.ai', 'gen.pollinations.ai', 'pollinations.ai', 'images.pollinations.ai', '.r2.cloudflarestorage.com'];
          const shouldProxy = proxiedHosts.some(s => host === s || host.endsWith(s));
          if (shouldProxy) {
            const proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(data.imageUrl)}`;
            finalData = { ...data, imageUrl: `${proxiedUrl}&v=${Date.now()}` };
          } else {
            finalData = { ...data, imageUrl: `${data.imageUrl}${data.imageUrl.includes('?') ? '&' : '?'}v=${Date.now()}` };
          }
        }
      } catch (e) {
        // ignore and use original data
      }
      setResult(finalData);
      toast({
        title: 'Image Regenerated',
        description: `Regenerated with ${finalData.style} style at ${Math.round(finalData.strength * 100)}% strength`
      });
    },
    onError: (error: any) => {
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
    const cleaned = trimmedPrompt.replace(/^\s*(?:add image\s*)+/i, '').replace(/^\s*"|"\s*$/g, '').trim();
    textToImageMutation.mutate({ prompt: cleaned, style: selectedStyle });
  }, [prompt, selectedStyle, toast, textToImageMutation]);

  const handleRegenerateWithStyle = useCallback((newStyle: string) => {
    if (!result) return;
    const imageToUse = generatedImage || baseImagePrompt || result.originalImageURL;
    if (!imageToUse) return;
    try {
      new URL(imageToUse);
      imageToImageMutation.mutate({
        imageURL: imageToUse,
        style: newStyle,
        strength: result.strength || 0.7
      });
    } catch (e) {
      console.warn('[BaseImageGenerator] Attempted to regenerate with non-URL image:', imageToUse);
      toast({
        title: 'Invalid Image',
        description: 'No valid image URL available to regenerate. Upload an image or select a generated image.',
        variant: 'destructive'
      });
    }
  }, [result, generatedImage, baseImagePrompt, imageToImageMutation, toast]);

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
          <div className="w-full max-h-[600px] overflow-hidden rounded border bg-gray-100 dark:bg-slate-900 flex items-center justify-center relative">
            {isPreloading && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-slate-900 z-10">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            )}
            <img
              src={result.imageUrl}
              alt={`Generated ${result.style}`}
              className="w-full h-auto object-contain transition-opacity duration-300"
              loading="lazy"
              onLoad={() => setIsPreloading(false)}
              onError={(e) => {
                setIsPreloading(false);
                const img = e.currentTarget as HTMLImageElement | null;
                const src = img?.src ?? '(unknown)';
                console.error('[BaseImageGenerator] Image load failed for src:', src);
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

          <div className="border-t pt-2 mt-2 flex flex-col gap-2">
            <Button
              variant="default"
              size="sm"
              className="w-full bg-green-600 hover:bg-green-700"
              onClick={() => {
                if (!result || !result.imageUrl) return;
                (async () => {
                  try {
                    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(result.imageUrl)}`;
                    const resp = await fetch(proxyUrl, { method: 'GET' });
                    if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
                    const blob = await resp.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `betagrace-${Date.now()}.jpg`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    toast({ title: 'Downloaded', description: 'Image saved as JPG' });
                  } catch (err) {
                    console.error('[BaseImageGenerator] Download failed', err);
                    toast({ title: 'Download Failed', description: 'Unable to download image', variant: 'destructive' });
                  }
                })();
              }}
              data-testid="button-download-image"
            >
              <Download className="w-4 h-4 mr-2" />
              Download as JPG
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setResult(null)}
              data-testid="button-clear-image"
            >
              Clear Image
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
