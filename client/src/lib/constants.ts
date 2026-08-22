import type { AIMode } from "@shared/schema";

// BetaGrace vI - Comprehensive constants and configuration

// Application metadata
export const APP_NAME = 'BetaGrace vI';
export const APP_VERSION = 'vI';
export const COMPANY_NAME = 'BetaGrace';
export const LAST_UPDATED = 'May 2026';
export const DEFAULT_DATA_RETENTION_DAYS = 30;
export const PRIVACY_POLICY_VERSION = '1.0';
export const TERMS_VERSION = '1.0';


// Age Requirement: 18+ (Adult-only service)
export const MIN_REQUIRED_AGE = 18;
export const COPPA_MIN_AGE = 18; // Updated: 18+ requirement
export const COPPA_NOTICE = 'BetaGrace is restricted to users 18 years of age or older. This service contains adult-oriented creative content and is not appropriate for minors. By continuing, you certify that you are at least 18 years old and legally able to access adult content.';

// Mode-specific colors (5 exclusive modes)
export const MODE_COLORS: Record<string, { bg: string; border: string; text: string; accent: string }> = {
  standard: {
    bg: 'bg-blue-50 dark:bg-blue-950',
    border: 'border-blue-300 dark:border-blue-700',
    text: 'text-blue-700 dark:text-blue-300',
    accent: 'bg-blue-500',
  },
  flesh_architect: {
    bg: 'bg-red-50 dark:bg-red-950',
    border: 'border-red-300 dark:border-red-700',
    text: 'text-red-700 dark:text-red-300',
    accent: 'bg-red-500',
  },
  sanctuary: {
    bg: 'bg-emerald-50 dark:bg-emerald-950',
    border: 'border-emerald-300 dark:border-emerald-700',
    text: 'text-emerald-700 dark:text-emerald-300',
    accent: 'bg-emerald-500',
  },
  advanced_reasoning: {
    bg: 'bg-violet-50 dark:bg-violet-950',
    border: 'border-violet-300 dark:border-violet-700',
    text: 'text-violet-700 dark:text-violet-300',
    accent: 'bg-violet-500',
  },
  autonomous: {
    bg: 'bg-amber-50 dark:bg-amber-950',
    border: 'border-amber-300 dark:border-amber-700',
    text: 'text-amber-700 dark:text-amber-300',
    accent: 'bg-amber-500',
  },
  video_generator: {
    bg: 'bg-rose-50 dark:bg-rose-950',
    border: 'border-rose-300 dark:border-rose-700',
    text: 'text-rose-700 dark:text-rose-300',
    accent: 'bg-rose-500',
  },
  code_graph: {
    bg: 'bg-cyan-50 dark:bg-cyan-950',
    border: 'border-cyan-300 dark:border-cyan-700',
    text: 'text-cyan-700 dark:text-cyan-300',
    accent: 'bg-cyan-500',
  },
  academic_research: {
    bg: 'bg-indigo-50 dark:bg-indigo-950',
    border: 'border-indigo-300 dark:border-indigo-700',
    text: 'text-indigo-700 dark:text-indigo-300',
    accent: 'bg-indigo-500',
  },
} as const;

// Faith Enhancement colors (for toggle indicator)
export const FAITH_ENHANCEMENT_COLORS = {
  bg: 'bg-purple-50 dark:bg-purple-950',
  border: 'border-purple-300 dark:border-purple-700',
  text: 'text-purple-700 dark:text-purple-300',
  accent: 'bg-purple-500',
} as const;

// Contact info
export const GITHUB_ISSUES_URL = 'https://github.com/thesweetlord/BetAGracevI/issues';

// ULTRA-ENHANCED Art styles for image generation (150+ DISTINCT styles with LAYERED INTEGRATION)
export const ART_STYLES = [
  // VIDEO GAME STYLES - HYPER-SPECIFIC WITH DEPTH
  'Universal fidelity style: preserve the exact subject, identity, anatomy, pose, clothing, materials, setting, and action described in the prompt; prioritize clear subject adherence, natural proportions, coherent spatial composition, accurate object relationships, realistic texture detail, intentional lighting, balanced color, sharp focal detail, and professional cinematic image quality; do not add an unrelated genre, palette, environment, character, prop, or mood',
  'Elden Ring style: luminous golden grace influence radiates from central elements, ornate baroque architecture merged with cosmic otherworldly elements, tarnished warrior aesthetic showing weathered nobility, erdtree golden glowing serves as focal point or background element, pastel sunset and dawn colors mixed strategically with gold, intricate ornamental designs covering surfaces with precision, crystalline magical effects with geometric clarity, ethereal floating particles suggest divine intervention, grace rays pierce through clouds from above, graceful flowing silhouettes contrast with rigid geometry',
  'Dark Souls III style: ash and ember aesthetic dominates color palette, massive decaying architecture towers overhead with overwhelming scale, bonfires provide warm orange contrast to blue-grey stone, abyss darkness threatens to consume edges of composition, detailed rust and oxidation textures on metal, skeletal enemies with intricate bone structure detail, sweeping curved architecture creates vertical emphasis, fog and haze limit visibility suggesting unknown dangers ahead, environmental storytelling through ruined kingdoms and fallen civilization remnants, oppressive weight of despair visible in lighting choices',
  'Bloodborne style: Victorian gothic architectural elements dominate foreground with ornate details, blood-soaked cobblestone streets reflecting lamplight, old wood and aged brick create brownish-red color foundation, eldritch cosmic horror suggested through impossible angles and non-Euclidean space, moonlit night atmosphere with pale luminescence, blood moons large and ominous in dark sky, beast creatures with anatomically disturbing features, cosmic wheels and tentacle suggestions in background shadows, body horror elements with practical flesh detail, sanity-breaking visual composition through scale distortion',
  'Dark Souls II style: varied architecture from multiple kingdoms creates visual richness, bright cyan bioluminescence contrasts with brown decay, crystal formations catch and refract light creating sparkle, smooth stone surfaces show age and wear realistically, memories and illusions suggested through translucent overlays, souls visible as particles floating through space, detailed enemy designs show practical evolution, lighting ranges from dark caverns to bright exterior areas, varied biome environments prevent visual monotony, sense of interconnected world despite visual variety',
  
  // EXTENDED ANIME/MANGA STYLES
  'Attack on Titan gritty anime style: monumental scale architecture towers impossibly, detailed mechanical gear designs with industrial precision, muted earth-tone color palette with selective highlights, scratchy sketch marks suggest violence and action, dynamic diagonal compositions convey urgency and panic, detailed human anatomy showing effort and strain, realistic fabric detail in military uniforms, atmospheric perspective creates depth across ravaged landscape, dramatic lighting from fires and explosions, human insignificance against giant threats emphasized constantly',
  'My Hero Academia vibrant anime style: bold saturated colors with strong primary emphasis, dynamic action poses with impossible physics, dramatic energy effects radiating from characters, detailed costume design with mechanical elements, intense eye expressions conveying emotion, speed lines suggest rapid movement and power, emotional intensity visible through lighting choices, diverse character designs showcase personality, background architecture and environments richly detailed, heroic confidence despite overwhelming odds',
  
  // CLASSICAL AND FINE ART - ENHANCED
  'Renaissance oil painting style: classical religious and mythological subjects treated with reverence, realistic human anatomy studied with scientific precision, mathematical perspective creates believable depth, rich earth tones with strategic ultramarine blue accents, thick paint application with visible masterful brushstrokes, dramatic chiaroscuro lighting emphasizing form, golden ratio composition creates natural balance, patron wealth displayed through gold leaf and precious materials, religious reverence through idealized beauty, timeless composition standing against changing fashions',
  'Caravaggio baroque dramatic style: extreme chiaroscuro with stark contrast between light and shadow, single light source creates theatrical spotlight effect, gold fabric and jewels catch dramatic illumination, dark mysterious backgrounds swallow space around lit subjects, emotional intensity through lighting alone, religious fervor visualized through light as divine presence, figure modeling shows realistic human physicality, composition draws eye to specific focal point through light, dramatic tension between light and dark symbolizes good and evil, masterful control of viewer attention through illumination',
  'Abstract expressionism energetic style: large gestural brushstrokes with visible raw energy, emotional intensity poured onto canvas through color field, spontaneous artistic action remains visible without correction, drip painting techniques create organic complexity, no recognizable subject matter liberates interpretation, pure color and form relationships suggest mood, artist feeling becomes visible to viewer immediately, monumental scale overwhelming viewer physically, chaos carefully controlled into cohesive composition, pure abstraction focusing on visual and emotional experience',
  
  // ENHANCED FILM AND CINEMA STYLES
  'Blade Runner 2049 neon-soaked style: neon pink and cyan rain reflections dominate surfaces, desert wastelands stretch endlessly with minimal vegetation, massive brutalist architecture creates oppressive scale, holographic elements glow with ethereal light, smoke and dust particles hang thick in air, orange and teal color grading becomes visual signature, empty expansive horizons convey isolation and vastness, decay and abandonment visible in every structure, sci-fi noir atmosphere combines retro-futurism with contemporary decay, contemplative lonely composition emphasizes solitude',
  'Inception impossible architecture style: non-euclidean geometry defies physics and perception, rotating hallways and endless staircases create spatial confusion, collapsing cityscapes fold in impossible directions, water bends gravity rather than following laws, multiple dream layers visible simultaneously through transparency, fractured reality shows cracks and distortions, spinning tops appear as visual metaphors for uncertainty, zero-gravity sequences defy natural physics, dreams-within-dreams create visual nesting, architectural precision serves impossible spaces',
  'Dune desert sci-fi style: massive sandworms emerging from beneath sand dwarf everything nearby, desert planet aesthetic with scientifically accurate sand dune formations, stillsuit-wearing figures show survival adaptation, spice-influenced desert mirage effects distort distance, political intrigue shown through imperial ornate architecture, sandstorm reduces visibility and creates danger atmosphere, ornithopter aircraft flying above dunes show scale, water as precious resource symbolism through its absence, foreign planet ecology visible in adapted life forms, epic scope emphasizes human insignificance',
  
  // PUNK AND ALTERNATIVE ENHANCED
  'Steampunk mechanical style: brass and copper machinery visible everywhere with intricate detail, Victorian-era aesthetics merged seamlessly with advanced technology, steam-powered mechanical devices functional and beautiful, intricate gear and clockwork mechanisms exposed and prominent, goggles and leather fashion combine practicality with style, airships and mechanical creatures show engineering mastery, industrial revolution innovation visible in every detail, analog precision engineering over digital simplification, cogwheel symbolism represents interconnected complexity, bronze and copper patina suggests age and reliability',
  'Dieselpunk 1940s retro-futurism style: 1930s-1950s technology imagined extended forward, diesel-powered mechanical vehicles show brutal efficiency, noir atmosphere combined with advanced military technology, military industrial aesthetic emphasizes power and conquest, art deco geometric forms combined with heavy machinery, worn metal and rust show realistic aging, factory worker and soldier imagery convey labor and duty, vintage advertising propaganda poster style suggests wartime, technological race between superpowers creates tension, weathered equipment suggests harsh use and durability',
  'Cyberpunk 2077 neon-drenched style: neon pink and cyan lighting creates addictive visual palette, corporate skyscrapers reach impossibly toward oppressive sky, digital implants visible through skin suggest transhumanism, holographic advertisements assault senses everywhere, dark rain-soaked streets reflect neon in puddles, chrome and metal textures replace organic materials, street-level poverty contrast emphasized against corporate wealth, neural connections glow with electric blue, cybernetic enhancements integrated into body, dystopian future technology permeates every surface',
  
  // PHOTOGRAPHY AND CINEMA ENHANCED
  'Film noir detective style: black and white with selective red accent light, shadows enveloping half of face create mystery, low-key dramatic lighting from single harsh source, rain-slicked streets reflect neon and lamplight, fedora detective and mysterious femme fatale characters, venetian blind window shadows cross faces geometrically, urban gritty cynicism pervades composition, moral ambiguity suggested through visual contradiction, hardboiled dialogue-inspired visual narrative, 1940s urban squalor detailed and realistic, cigarette smoke hangs thick in air obscuring details',
  'High contrast photography style: extreme blacks and whites with minimal midtone gradation, dramatic silhouettes reduce complexity to essential shapes, graphic shadow shapes become compositional elements, bold graphic design aesthetic elevates photograph to art, simplified visual impact creates immediate emotional response, emotional intensity conveyed through contrast alone, shape and form composition emphasizes geometry, striking visual punch demands viewer attention, minimal tonal palette focuses on essentials, conceptual clarity through contrast eliminates ambiguity',
  'Cinematic color grading style: widescreen 16:9 aspect ratio composition matches film standards, professional color grading creates consistent mood throughout, movie theater lighting technique optimizes for viewing conditions, depth of field with sharp focus isolates subject, shallow depth of field trickery blurs background into bokeh, perfect exposure and highlight detail preservation, commercial film production quality maintains polish, emotional moment composition guides viewer attention, Hollywood standard beauty through technical perfection, polished professional appearance signals high production value',
  
  // NATURE AND ENVIRONMENT ENHANCED
  'Hyper-realistic nature photography style: macro detail shows individual pollen and water droplets, photorealistic textures include every leaf vein and flower stamen, botanical precision combined with artistic composition, golden hour lighting maximizes warm color palette, depth of field creates three-dimensional quality, macro photography reveals hidden ecosystems, wildlife captured mid-action with behavioral accuracy, environmental context shows creature habitat and relationship, natural lighting without artificial enhancement, photographic authenticity suggests scientific documentation',
  'Mystical forest enchanted style: bioluminescent glowing plants light forest interior, ancient massive trees tower with gnarled bark and twisted roots, mist hangs thick obscuring distance creating mystery, ethereal creatures suggested in shadows and transparency, magical particles float through air carrying light, color palette shifts from cool shadows to warm glows, moss and fungus cover surfaces in rich green hues, spiral energy vortexes suggest magical presence, light shafts pierce canopy creating dramatic illumination, sense of untouched primordial wilderness despite magic',
  'Underwater ocean depths style: bioluminescent creatures provide only illumination, pressure creates crushing weight felt visually, strange alien lifeforms with adapted physiology, darkness interrupted by points of light creating eerie beauty, color shifts to deep blue and purple in depth, sand dunes on ocean floor create alien landscape, coral formations create intricate geometry, water refraction distorts shapes creating surreal appearance, silence suggested through muted colors and stillness, isolation emphasized by vast empty space',
  
  // ARTISTIC STYLES ENHANCED
  'Watercolor painting style: transparent layered washes build depth gradually, accidental pigment bleeding creates organic authentic effects, white paper shows through creating natural highlights, color diffusion and soft edges prevent harsh boundaries, spontaneous artistic freedom suggested through visible technique, nature subject dominance shows artist preference, light and ethereal quality pervades entire composition, quick expressive brushwork suggests speed and confidence, color blending happens on paper rather than palette, imperfection becomes beauty through acceptance',
  'Impressionist plein air style: broken color technique uses separate brushstrokes that optically mix, plein air outdoor painting aesthetic captures moment in time, focus on light and color transcends detail accuracy, water reflections and optical mixing create shimmer, pastel color palette creates luminous quality, loose composition suggests movement and life, temporary fleeting moment captured permanently, seasonal landscape exploration celebrates time of year, soft focus effect mimics human vision rather than photography, artists hand visible through brushwork authenticity',
  'Post-impressionist emotional style: bold symbolic colors deliberately depart from reality, structured brushstroke patterns create rhythmic movement, emotional intensity chosen over observational accuracy, expressive distortion of forms emphasizes feeling, flat perspective areas challenge traditional depth, decorative surface pattern becomes important as representation, personal artistic vision supersedes objective observation, thick paint application (impasto) creates tactile texture, emotional color relationships convey mood rather than reality, symbolic meaning embedded in color choices',
  
  // ADDITIONAL DISTINCTIVE STYLES
  'Tim Burton gothic twisted style: skeletal elongated proportions stretch anatomically, twisted organic shapes defy natural growth, black and white with selective color highlights, checkerboard patterns appear obsessively throughout, spiral and swirl motifs repeat hypnotically, jack-o-lantern grin expressions convey unsettling humor, eerie whimsy mixed with genuine darkness, oversized heads suggest thoughts dominate beings, stitched seams and mechanical elements visible, haunted toy aesthetic suggests loss of innocence',
  'Wes Anderson symmetrical style: perfect vertical symmetry creates uncanny balance, centered composition focuses viewer on exact midpoint, pastel color palette with precise color separation, flat graphic design aesthetic removes depth, whimsical typography integrated into scene, anthropomorphic animal characters suggest costume quality, hotel or mansion interiors show architectural perfection, miniature model appearance suggests controlled environment, deadpan character expressions resist easy interpretation, organized geometric frames compartmentalize action',
  'David Lynch surreal dreamlike style: dreamlike unsettling atmosphere pervades without explanation, red velvet textures appear incongruously, backwards speaking effects suggested visually through distortion, black and white with deeply troubling undertones, garbled audio visual correlates suggest communication breakdown, strange architectural impossibilities defy physics, unsettling lighting choices create psychological discomfort, veiled figures suggest hidden identity or shame, unexplained disturbing elements resist rational interpretation, mystery boxes remain unopened leaving questions',
  'Guillermo del Toro creature design style: intricate creature design features anatomically possible biology, fleshy textures and organic details show practical realism, practical prosthetic appearance suggests rubber and mechanics, monstrous intelligence shown through expressive eyes, fairy tale darkness combined with real-world grit, gothic architectural elements frame creatures beautifully, creature communication through gesture and posture, beautiful monster sympathy despite horrific appearance, organic materials contrasted with industrial setting, creatures feel dangerous yet sympathetic',
  'Hayao Miyazaki watercolor illustration style: delicate watercolor washes create dreamy quality, nature spirit characters possess otherworldly grace, flowing water effects depicted with particular mastery, forest and meadow landscapes celebrate natural beauty, gentle character expressions convey emotional depth, floating hair and fabric suggest movement and freedom, swirling wind lines create dynamic composition, hand-painted imperfections add authenticity, nostalgic childhood wonder permeates every scene, detailed natural world observations show scientific interest',
  'Studio Trigger explosion action style: over-the-top dynamic action with impossible physics, vibrant neon colors assault visual senses, exaggerated facial expressions and reactions convey drama, speed line overdose creates kinetic energy, transformation sequences show dramatic metamorphosis, magical girl explosions with sparkle and light, mechanical and organic fusion creates unique aesthetic, ultra-detailed combat choreography shows mastery, screentone patterns reference comic book tradition, intense emotional drama elevates action sequences',
  'Jesus Christ and Saints Divine Light style: Christ as central luminous figure radiating golden divine light rays from core, halo effect with layered ethereal glow surrounding sacred figures, saints depicted in flowing robes with uplifted expressions toward heavenly light, Renaissance religious iconography merged with mystical luminosity, truth symbolized through divine radiance piercing all darkness, love expressed through gentle facial features and open welcoming gestures, light literally emanating from sacred presence illuminating surrounding figures, angels and celestial beings surrounding in supportive formation, dove symbol suggesting peace and holy spirit presence, intricate sacred geometry patterns frame central figures, gold leaf and precious metal effects suggest divine blessing, compassionate expressions convey unconditional agape love, architectural sacred spaces like cathedrals contain the divine gathering, atmospheric perspective shows spiritual ascension upward, color palette dominated by gold, white, and soft blues suggesting heaven, ethereal and transcendent quality pervades entire composition',
];

export type ArtStyle = typeof ART_STYLES[number];
