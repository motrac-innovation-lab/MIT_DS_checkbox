// Domeinmodellen. Nog leeg op de app-rol na: het domein van de Sales offerte
// converter komt in een volgende stap (zie CLAUDE.md, "Volgende stap").

/**
 * App-rol, afgeleid van het profiel in Motrac-beheer. Dit zijn de twee
 * standaard `app_rollen` die Motrac-beheer voor elke nieuwe app aanmaakt
 * (zie context/AuthContext.tsx voor de afleiding uit de ruwe rolstring).
 */
export type Role = 'gebruiker' | 'admin'
