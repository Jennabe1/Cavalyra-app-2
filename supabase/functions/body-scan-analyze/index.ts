// Cavalyra Body Scanner – image-based vision analysis via Lovable AI Gateway
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `Du bist Cavalyra Body Scanner – ein erfahrener Pferdeexperte mit Wissen aus Tiermedizin, Hufbearbeitung, Physiotherapie und Reitlehre. Du analysierst bis zu 5 Fotos eines Pferdes (seitlich rechts, seitlich links, von vorne, von hinten, von oben) und erstellst eine sachliche, verständliche Einschätzung für Pferdebesitzer in deutscher Sprache.

WICHTIG – Tier-Erkennung ZUERST: Prüfe als allererstes, ob auf den hochgeladenen Fotos tatsächlich ein Pferd (oder Pony / Esel / Maultier) zu sehen ist. Wenn die Mehrheit der Bilder oder alle Bilder ein anderes Tier (Hund, Katze, Kuh, Schaf, Ziege, Kaninchen, Vogel, Schwein, etc.), einen Menschen, ein Fahrzeug, eine Landschaft ohne Tier oder etwas anderes zeigen, gib AUSSCHLIESSLICH folgendes JSON zurück und NICHTS anderes:
{"notAHorse": true, "detected": "kurze Beschreibung was tatsächlich auf den Bildern zu sehen ist"}

Nur wenn ein Pferd auf den Bildern klar erkennbar ist, führe die vollständige Analyse durch und bewerte:
- Fettpolster (Halskamm, Schulterauflage, Widerrist, Rippenbereich, Schweifansatz, Bauchlinie)
- Muskulatur und mögliche Muskelatrophie (Oberlinie, Kruppe, Hinterhand, Schulter, Hals)
- Fehlstellungen (Beinachsen vorne/hinten, Hufstellung, Trachten, Stellung der Gliedmaßen, Rückenlinie, Becken/Asymmetrie)
- Exterieur insgesamt (Proportionen, Stellung, harmonisches Gesamtbild) – auch POSITIVE Punkte ausdrücklich nennen
- Auffälligkeiten am Exterieur (Senkrücken, Karpfenrücken, Überbau, kuhhessig, bodenweit/-eng, vorständig, untergeschoben, Schiefe usw.)

Bei festgestellten Problemen gib praktische, konkrete Tipps:
- Verdacht Übergewicht / EMS / Hufrehe-Risiko: Futter reduzieren (Kraftfutter, Müsli, Mash), Heumenge & Energiegehalt prüfen, Weidezeit/Graszufuhr einschränken, Heunetze nutzen, Hufpfleger/Tierarzt informieren, Bewegung schrittweise aufbauen
- Muskelatrophie: Tierarzt zur Gesundheitsprüfung (PSSM, Cushing, Borreliose, Zahn-/Sattelprobleme), Futter checken (mehr hochwertiges Protein, Aminosäuren, Vitamin E, Selen), Trainingsplan an Muskelaufbau anpassen (Schritt, Stangenarbeit, Bergauf), Sattelkontrolle, Physiotherapie
- Fehlstellungen: Hufbearbeiter konsultieren, Sattler, ggf. orthopädischer Beschlag, Tierarzt für Bewegungsanalyse
- Sache fragwürdig oder unklar: Hinweis auf Tierarztbesuch

Wenn ein Pferd erkannt wurde, gib AUSSCHLIESSLICH valides JSON zurück, exakt nach folgendem Schema – ohne Markdown-Codeblöcke (kein \`\`\`json), ohne Erklärtext drumherum, NUR das reine JSON-Objekt:
{
  "bodyCondition": Zahl 1-9 (Henneke Body Condition Score, 5 = ideal),
  "muscleScore": Zahl 0-100,
  "symmetryScore": Zahl 0-100,
  "exteriorScore": Zahl 0-100,
  "assessment": {
    "body":     {"title": string, "text": string (3-6 Sätze), "tips": [string,...]},
    "muscle":   {"title": string, "text": string (3-6 Sätze), "tips": [string,...]},
    "symmetry": {"title": string, "text": string (3-6 Sätze), "tips": [string,...]},
    "exterior": {"title": string, "text": string (3-6 Sätze), "tips": [string,...]}
  },
  "positives": [string,...] (mindestens 2 positive Punkte zum Exterieur/Pferd),
  "findings": [string,...] (alle wichtigen Beobachtungen, 4-8 Punkte),
  "recommendation": string (1-3 Sätze konkrete nächste Schritte)
}

Sei ehrlich aber nicht alarmistisch. Schreibe für Pferdebesitzer:innen, nicht für Tierärzt:innen. Wenn die Bildqualität für eine Aussage nicht reicht, sag das ehrlich im jeweiligen Abschnitt.`;

const STRICT_RETRY_HINT = `\n\nWICHTIG: Gib AUSSCHLIESSLICH das reine JSON-Objekt zurück. Kein Markdown, keine \`\`\`-Codeblöcke, kein Text davor oder danach. Antwort MUSS mit { beginnen und mit } enden.`;

// Robust JSON parser: strips markdown fences, extracts first {...} block
function tryParseAnalysis(raw: unknown): any | null {
  if (raw && typeof raw === "object") return raw;
  let s = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
  if (!s) return null;

  // Strip ```json ... ``` or ``` ... ``` fences
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();

  // Direct parse
  try { return JSON.parse(s); } catch { /* fall through */ }

  // Extract first balanced {...} block
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          const candidate = s.slice(start, i + 1);
          try { return JSON.parse(candidate); } catch { return null; }
        }
      }
    }
  }
  return null;
}

async function callGateway(apiKey: string, userContent: any[], strict: boolean) {
  const systemPrompt = strict ? SYSTEM_PROMPT + STRICT_RETRY_HINT : SYSTEM_PROMPT;
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { photos, horseName } = await req.json();

    // --- Input validation BEFORE any AI call (spart Credits bei kaputten Uploads) ---
    if (!Array.isArray(photos) || photos.length < 1) {
      return new Response(JSON.stringify({ error: "Bitte mindestens ein Foto hochladen." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const validPhotos = photos.filter((p: any) =>
      p && typeof p.dataUrl === "string" && p.dataUrl.startsWith("data:image/") && p.dataUrl.length > 200
    );
    if (validPhotos.length < 1) {
      return new Response(JSON.stringify({ error: "Keine gültigen Bilder erkannt. Bitte erneut hochladen." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Reject oversized payload (>6 MB pro Bild führt häufig zu Timeout / Fehler)
    const tooBig = validPhotos.find((p: any) => p.dataUrl.length > 8_500_000); // ~6.3 MB binary
    if (tooBig) {
      return new Response(JSON.stringify({ error: "Mindestens ein Foto ist zu groß. Bitte Fotos unter 6 MB hochladen." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userContent: any[] = [
      { type: "text", text: `Analysiere die folgenden Fotos des Pferdes${horseName ? ` "${horseName}"` : ""} (Position jeweils angegeben). Antworte ausschließlich im vorgegebenen JSON-Format ohne Markdown.` },
    ];
    for (const p of validPhotos) {
      userContent.push({ type: "text", text: `Position: ${p.position || "unbekannt"}` });
      userContent.push({ type: "image_url", image_url: { url: p.dataUrl } });
    }

    // --- First attempt ---
    let aiRes = await callGateway(LOVABLE_API_KEY, userContent, false);

    if (!aiRes.ok) {
      const errTxt = await aiRes.text();
      const status = aiRes.status;
      let message = "Analyse fehlgeschlagen.";
      if (status === 429) message = "Aktuell zu viele Anfragen. Bitte in einer Minute erneut versuchen.";
      else if (status === 402) message = "Service vorübergehend nicht verfügbar. Bitte später erneut versuchen.";
      console.error("AI gateway error", status, errTxt);
      return new Response(JSON.stringify({ error: message, status, detail: errTxt }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let aiJson = await aiRes.json();
    let raw = aiJson?.choices?.[0]?.message?.content ?? "";
    let analysis = tryParseAnalysis(raw);

    // --- Silent server-side retry on parse failure (Nutzer sieht nur einen Vorgang) ---
    if (!analysis || typeof analysis !== "object") {
      console.warn("First attempt unparseable, retrying with strict prompt. Raw start:", String(raw).slice(0, 200));
      const retryRes = await callGateway(LOVABLE_API_KEY, userContent, true);
      if (retryRes.ok) {
        aiJson = await retryRes.json();
        raw = aiJson?.choices?.[0]?.message?.content ?? "";
        analysis = tryParseAnalysis(raw);
      } else {
        console.error("Retry gateway error", retryRes.status, await retryRes.text());
      }
    }

    if (!analysis || typeof analysis !== "object") {
      return new Response(JSON.stringify({ error: "Analyse-Antwort konnte nicht gelesen werden.", raw }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ analysis }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("body-scan-analyze error", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
