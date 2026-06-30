import type {
  SingulareFundConfig,
  SingulareReportRecord,
  SingulareReportSections,
} from "@/server/singulare/types";

const TOKEN_URL = "https://api-portal.singulare.com.br/v2/painel/token/api";
const REPORT_BASE_URL = "https://api-portal.singulare.com.br/v2/netreport/report";

type TokenResponse = {
  apiToken?: string;
};

type CarteiraResponse = {
  relatórios?: SingulareReportSections;
};

type DemonstrativoCaixaResponse = {
  relatórios?: {
    "demonstrativo-caixa"?: SingulareReportRecord[];
  };
};

function getCredentials() {
  const clientId = process.env.SINGULARE_CLIENT_ID;
  const clientSecret = process.env.SINGULARE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Credenciais da Singulare ausentes. Configure SINGULARE_CLIENT_ID e SINGULARE_CLIENT_SECRET."
    );
  }

  return { clientId, clientSecret };
}

export async function getSingulareApiToken(): Promise<string> {
  const { clientId, clientSecret } = getCredentials();
  const encodedCredentials = Buffer.from(
    `${clientId}:${clientSecret}`,
    "latin1"
  ).toString("base64");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodedCredentials}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  console.info(`[Singulare] token/api - ${response.status}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Erro ao obter apiToken da Singulare: HTTP ${response.status} - ${body}`
    );
  }

  const data = (await response.json()) as TokenResponse;
  if (!data.apiToken) {
    throw new Error("Resposta da Singulare sem campo apiToken.");
  }

  return data.apiToken;
}

export async function getSingulareCarteira(
  apiToken: string,
  fund: SingulareFundConfig,
  dataAnalise: string
): Promise<SingulareReportSections | null> {
  const url = `${REPORT_BASE_URL}/fund/${encodeURIComponent(
    fund.fundClassKey
  )}/${dataAnalise}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": apiToken,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  console.info(
    `[Singulare] recuperar_carteira (${fund.label}) - ${response.status}`
  );

  if (!response.ok) {
    const body = await response.text();
    console.error(
      `[Singulare] erro ao consultar carteira ${fund.label}: HTTP ${response.status} - ${body}`
    );
    return null;
  }

  const data = (await response.json()) as CarteiraResponse;
  if (!data.relatórios) {
    console.warn(
      `[Singulare] resposta de ${fund.label} sem "relatórios"; importação do fundo ignorada.`
    );
    return null;
  }

  return data.relatórios;
}

export async function getSingulareDemonstrativoCaixa(
  apiToken: string,
  dataAnalise: string
): Promise<SingulareReportRecord[] | null> {
  const url = `${REPORT_BASE_URL}/market/demonstrativo-caixa/${dataAnalise}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": apiToken,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  console.info(`[Singulare] demonstrativo_caixa - ${response.status}`);

  if (!response.ok) {
    const body = await response.text();
    console.error(
      `[Singulare] erro ao consultar demonstrativo de caixa: HTTP ${response.status} - ${body}`
    );
    return null;
  }

  const data = (await response.json()) as DemonstrativoCaixaResponse;
  const records = data.relatórios?.["demonstrativo-caixa"];

  if (!records) {
    console.warn(
      '[Singulare] resposta do demonstrativo de caixa sem "relatórios.demonstrativo-caixa".'
    );
    return null;
  }

  return records;
}
