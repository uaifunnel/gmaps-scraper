import express from "express";
import cors from "cors";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import NodeCache from "node-cache";
import path from "path";
import { fileURLToPath } from "url";
import chromium from "@sparticuz/chromium";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

// Cache inteligente - 1 hora
const cache = new NodeCache({ stdTTL: 3600 });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Endpoint avançado com filtros
app.post("/scrape-advanced", async (req, res) => {
    const { 
        termoBusca, 
        maxResults = 20,
        minRating = 0,           
        regiao = '',             
        incluirHorarios = false, 
        incluirReviews = false   
    } = req.body;
    
    if (!termoBusca) {
        return res.status(400).json({ error: "Termo de busca não fornecido." });
    }

    // Verificar cache
    const cacheKey = `${termoBusca}-${regiao}-${minRating}-${maxResults}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return res.json({ 
            ...cached, 
            fromCache: true,
            message: "Dados do cache - resposta instantânea!" 
        });
    }

    let browser;
    try {
        // 🔧 CONFIGURAÇÃO ESPECÍFICA PARA RENDER
        // Configuração específica para Render
        const isProduction = process.env.NODE_ENV === 'production';

        browser = await puppeteer.launch({
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--single-process', // Importante para Render
            '--no-zygote',     // Importante para Render
        ],
        headless: true,
        ignoreHTTPSErrors: true,
        executablePath: isProduction ? 
            await chromium.executablePath() : 
            puppeteer.executablePath(),
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        });

        // Busca com região
        const searchTerm = regiao ? `${termoBusca} ${regiao}` : termoBusca;
        const searchURL = `https://www.google.com/maps/search/${encodeURIComponent(searchTerm)}`;
        
        await page.goto(searchURL, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Auto scroll para carregar mais resultados
        await autoScroll(page);

        const links = await page.evaluate(() => {
            const anchors = document.querySelectorAll('a[href*="/place/"]');
            return Array.from(anchors)
                .map(a => a.href)
                .filter((href, index, arr) => arr.indexOf(href) === index)
                .slice(0, 50);
        });

        // Processamento paralelo
        const results = await processLinksParallel(browser, links.slice(0, maxResults), {
            minRating,
            incluirHorarios,
            incluirReviews
        });

        // Filtrar por avaliação
        const filteredResults = results.filter(item => {
            const rating = parseFloat(item.avaliacao);
            return !isNaN(rating) ? rating >= minRating : true;
        });

        const responseData = {
            resultados: filteredResults,
            total: filteredResults.length,
            termo: termoBusca,
            regiao: regiao || 'Todas as regiões',
            filtros: { minRating, incluirHorarios, incluirReviews }
        };

        // Salvar no cache
        cache.set(cacheKey, responseData);

        res.json(responseData);

    } catch (error) {
        console.error("Erro:", error);
        res.status(500).json({ error: "Erro ao processar requisição: " + error.message });
    } finally {
        if (browser) await browser.close();
    }
});

// Processamento paralelo de links
async function processLinksParallel(browser, links, options) {
    const results = [];
    const batchSize = 1; // ✅ MUDANÇA 1: Processar 1 por vez no Render Free
    
    for (let i = 0; i < links.length; i += batchSize) {
        const batch = links.slice(i, i + batchSize);
        const batchPromises = batch.map(link => processLink(browser, link, options));
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
                results.push(result.value);
                console.log(`✅ Lote ${Math.floor(i/batchSize) + 1} - Item ${index + 1} processado`);
            }
        });
        
        // ✅ MUDANÇA 2: Pausa maior entre lotes para Render
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    return results;
}

// Processar link individual
async function processLink(browser, link, options) {
    const subPage = await browser.newPage();
    
    try {
        // ✅ MUDANÇA 3: Timeout maior para páginas lentas
        await subPage.goto(link, { waitUntil: "domcontentloaded", timeout: 25000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        const dados = await subPage.evaluate((opts) => {
            const getNome = () => {
                const selectors = ['h1.DUwDvf', 'h1[data-attrid="title"]', 'h1'];
                for (let selector of selectors) {
                    const el = document.querySelector(selector);
                    if (el) return el.textContent.trim();
                }
                return null;
            };

            const getEndereco = () => {
                const selectors = [
                    'button[data-item-id="address"] .W4Efsd',
                    '[data-item-id="address"]',
                    '.Io6YTe'
                ];
                for (let selector of selectors) {
                    const el = document.querySelector(selector);
                    if (el) return el.textContent.trim();
                }
                return null;
            };

            const getTelefone = () => {
                const selectors = [
                    'button[data-item-id="phone"] .W4Efsd',
                    '[data-item-id="phone"]'
                ];
                for (let selector of selectors) {
                    const el = document.querySelector(selector);
                    if (el) return el.textContent.trim();
                }
                return null;
            };

            const getAvaliacao = () => {
                const el = document.querySelector('.MW4etd');
                return el ? el.textContent.trim() : null;
            };

            const getCategoria = () => {
                const el = document.querySelector('.DkEaL');
                return el ? el.textContent.trim() : null;
            };

            // Horários de funcionamento
            const getHorarios = () => {
                if (!opts.incluirHorarios) return null;
                const horariosEl = document.querySelector('.t39EBf');
                return horariosEl ? horariosEl.textContent.trim() : null;
            };

            // Reviews
            const getReviews = () => {
                if (!opts.incluirReviews) return [];
                const reviews = document.querySelectorAll('.jftiEf');
                return Array.from(reviews).slice(0, 3).map(review => ({
                    texto: review.querySelector('.wiI7pd')?.textContent?.trim() || '',
                    autor: review.querySelector('.d4r55')?.textContent?.trim() || '',
                    rating: review.querySelector('.kvMYJc')?.getAttribute('aria-label') || ''
                }));
            };

            return {
                nome: getNome(),
                endereco: getEndereco(),
                telefone: getTelefone(),
                avaliacao: getAvaliacao(),
                categoria: getCategoria(),
                horarios: getHorarios(),
                reviews: getReviews()
            };
        }, options);

        return {
            nome: dados.nome || "Não encontrado",
            endereco: dados.endereco || "Não encontrado", 
            telefone: dados.telefone || "Não encontrado",
            avaliacao: dados.avaliacao || "Não encontrado",
            categoria: dados.categoria || "Não encontrado",
            horarios: dados.horarios || "Não encontrado",
            reviews: dados.reviews || [],
            link: link
        };

    } catch (error) {
        console.error(`Erro no link ${link}:`, error.message);
        return null;
    } finally {
        await subPage.close();
    }
}

// Auto scroll
async function autoScroll(page) {
    await page.evaluate(async () => {
        const scrollContainer = document.querySelector('[role="main"]') || document.body;
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 200;
            const timer = setInterval(() => {
                scrollContainer.scrollBy(0, distance);
                totalHeight += distance;

                if(totalHeight >= scrollContainer.scrollHeight - window.innerHeight){
                    clearInterval(timer);
                    resolve();
                }
            }, 150);
        });
    });
}

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📱 Acesse: http://localhost:${PORT}`);
    console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});