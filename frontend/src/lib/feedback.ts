import type { FeedbackVerzendPayload } from '@motrac/template-ui'
import { request } from './api'

// De capture (schermafbeelding, element-picker, markeringen) zit in
// @motrac/template-ui's FeedbackWidget; dit bestand is alleen het transport.
// Post naar de EIGEN backend (POST /api/feedback), die het pas na server-side
// auth doorzet naar Motrac-beheer — zie backend/server.js. Dit pakket doet
// zelf geen netwerkverkeer naar Motrac-beheer.
export async function verstuurFeedback(payload: FeedbackVerzendPayload): Promise<void> {
  await request<unknown>('/api/feedback', {
    method: 'POST',
    // Veldnamen volgen het v1-contract van Motrac-beheer (INTEGRATIE.md);
    // de eigen backend zet er server-side alleen userLabel bij.
    body: {
      type: payload.type,
      message: payload.tekst,
      pageContext: payload.paginaPad,
      screenshotBase64: payload.schermafbeelding?.volBase64,
      screenshotMime: payload.schermafbeelding?.mime,
      thumbBase64: payload.schermafbeelding?.thumbBase64,
      viewportBreedte: payload.viewportBreedte,
      viewportHoogte: payload.viewportHoogte,
      thema: payload.thema,
      userAgent: payload.userAgent,
      annotatie: payload.annotatie,
    },
  })
}
