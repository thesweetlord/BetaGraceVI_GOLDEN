"""
Scene Prompts — The Narrative Manifest Input

Define your 20 scenes here. Each dict is passed to Stage 1 (NarrativeManifestGenerator).

Required keys:
  prompt (str)             — The primary text-to-image generation prompt.

Optional keys (override pipeline config defaults per scene):
  negative_prompt (str)    — What to exclude from the image.
  image_cfg_scale (float)  — CFG scale override for this scene's image generation.
  image_steps (int)        — Sampling steps override for this scene.
  style_preset (str)       — Stability AI style preset (e.g. 'cinematic', 'photographic').
  motion_bucket_id (int)   — SVD motion bucket override for this scene (lower = less motion).
  conditioning_scale (float) — I2V image conditioning weight override (0.85–0.92).
  scene_duration_seconds (float) — Duration of this scene's video clip.
  camera_motion (str)      — FFmpeg camera effect: 'static' | 'pan_left' | 'pan_right' |
                             'pan_up' | 'pan_down' | 'zoom_in' | 'zoom_out' | 'ken_burns'
  metadata (dict)          — Arbitrary metadata stored in the manifest (e.g. act, chapter).
"""

SCENE_PROMPTS = [
    # ── Act I — Awakening ──────────────────────────────────────────────────────
    {
        "prompt": (
            "Ultra-wide establishing shot of a misty mountain valley at golden hour, "
            "towering ancient pines silhouetted against a burning amber sky, "
            "rays of sunlight cutting through low-lying fog banks, photorealistic, "
            "cinematic, 8K resolution, shot on IMAX"
        ),
        "negative_prompt": "blurry, low quality, watermark, text, people, urban",
        "style_preset": "photographic",
        "camera_motion": "pan_right",
        "scene_duration_seconds": 6.0,
        "metadata": {"act": 1, "chapter": "Awakening", "scene_name": "Valley Dawn"},
    },
    {
        "prompt": (
            "Macro close-up of a single dew drop on a spider's web at dawn, "
            "the droplet refracting an entire forest landscape within it, "
            "shallow depth of field, bokeh background, photorealistic macro photography, "
            "hyper-detailed, award-winning nature photography"
        ),
        "camera_motion": "zoom_in",
        "scene_duration_seconds": 5.0,
        "metadata": {"act": 1, "scene_name": "The Dewdrop"},
    },
    {
        "prompt": (
            "Aerial bird's-eye view of a dense ancient forest canopy at sunrise, "
            "rivers of mist threading through treetops like silver veins, "
            "warm orange and pink sky reflected in a distant lake, "
            "drone cinematography, cinematic color grading"
        ),
        "camera_motion": "pan_left",
        "metadata": {"act": 1, "scene_name": "Forest Canopy"},
    },
    {
        "prompt": (
            "A lone figure standing on a coastal cliff edge at sunrise, "
            "dramatic ocean waves crashing far below, the horizon glowing with "
            "molten gold light, long exposure photography aesthetic, "
            "epic scale, silhouette composition"
        ),
        "camera_motion": "ken_burns",
        "metadata": {"act": 1, "scene_name": "The Cliff"},
    },
    {
        "prompt": (
            "Time-lapse-style photograph of a star trail over a remote desert mesa, "
            "circular star trails arcing over dramatic red rock formations, "
            "Milky Way core faintly visible, astrophotography, "
            "ultra-wide 14mm lens, long exposure, National Geographic quality"
        ),
        "camera_motion": "zoom_out",
        "metadata": {"act": 1, "scene_name": "Star Trails"},
    },

    # ── Act II — Journey ───────────────────────────────────────────────────────
    {
        "prompt": (
            "Ancient stone archway leading into an overgrown jungle temple, "
            "warm shafts of dappled sunlight breaking through the forest canopy above, "
            "moss-covered carved stone walls, tropical ferns and vines reclaiming the ruins, "
            "cinematic depth, photorealistic, adventure film aesthetic"
        ),
        "camera_motion": "zoom_in",
        "metadata": {"act": 2, "scene_name": "The Archway"},
    },
    {
        "prompt": (
            "A wide river canyon with walls of striated red and orange sandstone "
            "rising 1000 feet on either side, a narrow turquoise river threading "
            "through the bottom, soft diffused light from directly above, "
            "slot canyon photography, breathtaking scale"
        ),
        "camera_motion": "pan_up",
        "metadata": {"act": 2, "scene_name": "The Canyon"},
    },
    {
        "prompt": (
            "Abandoned Victorian greenhouse overrun with exotic tropical plants, "
            "broken glass panes letting in shafts of golden afternoon light, "
            "wild orchids blooming among rusted iron frames, "
            "atmospheric haze, dust motes floating in light beams, "
            "photorealistic, melancholic beauty"
        ),
        "camera_motion": "pan_right",
        "metadata": {"act": 2, "scene_name": "The Greenhouse"},
    },
    {
        "prompt": (
            "Vast ice cave interior with walls of translucent electric blue glacial ice, "
            "bioluminescent blue light emanating from deep within the ice, "
            "frozen stalactites hanging from a cathedral-like ceiling, "
            "photorealistic, otherworldly, National Geographic photography"
        ),
        "camera_motion": "zoom_in",
        "metadata": {"act": 2, "scene_name": "Ice Cathedral"},
    },
    {
        "prompt": (
            "A cascading waterfall plunging 300 feet into a perfectly circular pool "
            "of emerald green water in a hidden jungle gorge, "
            "rainbow mist from the falls, lush tropical vegetation on all sides, "
            "long exposure waterfall photography, paradise aesthetic"
        ),
        "camera_motion": "pan_down",
        "metadata": {"act": 2, "scene_name": "Hidden Falls"},
    },

    # ── Act III — Revelation ───────────────────────────────────────────────────
    {
        "prompt": (
            "Vast underground cavern with a subterranean lake reflecting bioluminescent "
            "blue crystals growing on the cave ceiling like an inverted galaxy, "
            "perfect mirror reflections, ethereal otherworldly atmosphere, "
            "photorealistic, fantasy realism"
        ),
        "camera_motion": "ken_burns",
        "metadata": {"act": 3, "scene_name": "Crystal Cavern"},
    },
    {
        "prompt": (
            "A massive ancient tree, estimated 3000 years old, its trunk 30 meters wide, "
            "roots spreading across the forest floor like a city's street map, "
            "soft morning fog drifting through the ancient forest around it, "
            "low angle shot looking up, photorealistic, monumental scale"
        ),
        "camera_motion": "zoom_out",
        "metadata": {"act": 3, "scene_name": "The Ancient Tree"},
    },
    {
        "prompt": (
            "Panoramic view from the summit of a volcanic mountain looking out over "
            "a vast cloud sea below with other volcanic peaks emerging like islands, "
            "golden hour light painting the clouds in pink and purple, "
            "epic landscape photography, above-the-clouds perspective"
        ),
        "camera_motion": "pan_left",
        "metadata": {"act": 3, "scene_name": "Cloud Sea"},
    },
    {
        "prompt": (
            "Interior of a towering gothic cathedral filled with beams of multicolored "
            "light streaming through enormous stained glass rose windows, "
            "light painting patterns across ancient stone floors, "
            "architectural photography, transcendent atmosphere, 16mm wide angle"
        ),
        "camera_motion": "zoom_in",
        "metadata": {"act": 3, "scene_name": "The Cathedral"},
    },
    {
        "prompt": (
            "Extreme close-up of human eye reflecting an entire landscape within the iris, "
            "micro-photography style, the iris texture resembling a alien world topography, "
            "surreal macro photography, high contrast, cinematic color grade"
        ),
        "camera_motion": "zoom_in",
        "scene_duration_seconds": 4.0,
        "metadata": {"act": 3, "scene_name": "The Eye"},
    },

    # ── Act IV — Resolution ────────────────────────────────────────────────────
    {
        "prompt": (
            "A remote lighthouse standing on a rocky promontory during a violent ocean storm, "
            "massive waves crashing and exploding against the rocks in white spray, "
            "dark dramatic storm clouds, the lighthouse beam cutting through the chaos, "
            "dramatic seascape photography, raw power of nature"
        ),
        "camera_motion": "ken_burns",
        "metadata": {"act": 4, "scene_name": "The Lighthouse"},
    },
    {
        "prompt": (
            "A meadow of wildflowers — poppies, lavender, and cosmos — stretching to the horizon "
            "under a dramatic cloudy sky with rays of sunlight breaking through, "
            "bokeh foreground wildflowers, painterly color palette, "
            "cinematic wide shot, golden hour, photorealistic"
        ),
        "camera_motion": "pan_right",
        "metadata": {"act": 4, "scene_name": "Wildflower Meadow"},
    },
    {
        "prompt": (
            "A frozen lake at winter twilight, the ice surface perfectly clear and mirror-like, "
            "reflecting the last pink and blue light of the fading sky, "
            "bare birch trees lining the distant shore, "
            "fine art landscape photography, serene, minimalist composition"
        ),
        "camera_motion": "pan_left",
        "metadata": {"act": 4, "scene_name": "Frozen Lake"},
    },
    {
        "prompt": (
            "Epic desert landscape at magic hour — endless terracotta sand dunes "
            "casting long geometric shadows, a camel caravan silhouetted on the "
            "distant ridge line, deep blue sky above, rich warm tones, "
            "Lawrence of Arabia cinematography aesthetic"
        ),
        "camera_motion": "zoom_out",
        "scene_duration_seconds": 6.0,
        "metadata": {"act": 4, "scene_name": "Desert Caravan"},
    },
    {
        "prompt": (
            "Final wide shot: the same mountain valley from Scene 1, now at dusk, "
            "the sky transitioning from deep blue to violet to warm amber at the horizon, "
            "the first stars beginning to appear, "
            "the valley mist rising as the day closes, circular narrative completion, "
            "photorealistic, IMAX quality, cinematic mastershot"
        ),
        "camera_motion": "zoom_out",
        "scene_duration_seconds": 8.0,
        "metadata": {"act": 4, "scene_name": "Valley Dusk — Circular Return"},
    },
]

# Validate scene count matches expected pipeline configuration
assert len(SCENE_PROMPTS) == 20, (
    f"SCENE_PROMPTS must contain exactly 20 scenes. "
    f"Currently has {len(SCENE_PROMPTS)}."
)
