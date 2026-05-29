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

Wenn ein Pferd erkannt wurde, gib AUSSCHLIESSLICH valides JSON zurück, exakt nach folgendem Schema – ohne Markdown, ohne Erklärtext drumherum:
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { photos, horseName } = await req.json();
    if (!Array.isArray(photos) || photos.length < 1) {
      return new Response(JSON.stringify({ error: "photos[] required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userContent: any[] = [
      { type: "text", text: `Analysiere die folgenden 5 Fotos des Pferdes${horseName ? ` "${horseName}"` : ""} (Position jeweils angegeben). Antworte ausschließlich im vorgegebenen JSON-Format.` },
    ];
    for (const p of photos) {
      if (!p || !p.dataUrl) continue;
      userContent.push({ type: "text", text: `Position: ${p.position || "unbekannt"}` });
      userContent.push({ type: "image_url", image_url: { url: p.dataUrl } });
    }

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const errTxt = await aiRes.text();
      const status = aiRes.status;
      let message = "Analyse fehlgeschlagen.";
      if (status === 429) message = "Aktuell zu viele Anfragen. Bitte in einer Minute erneut versuchen.";
      else if (status === 402) message = "AI-Guthaben aufgebraucht. Bitte im Lovable Workspace Credits ergänzen.";
      console.error("AI gateway error", status, errTxt);
      return new Response(JSON.stringify({ error: message, status, detail: errTxt }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiJson = await aiRes.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "";
    let analysis: any = null;
    try {
      analysis = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (_) {
      // try to find a JSON block
      const m = String(raw).match(/\{[\s\S]*\}/);
      if (m) {
        try { analysis = JSON.parse(m[0]); } catch (_) { /* ignore */ }
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
