async (page) => {
  const targetUrl = "https://agent-ovo.github.io/policy-impact-terminal/";
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.includes("google.com/s2/favicons")) {
      requestFailures.push(`${request.failure()?.errorText || "request failed"}: ${url}`);
    }
  });

  const readVisibleFailure = async () => {
    const candidates = page.locator(".report-unavailable.error, .report-load-banner.error, .auth-error");
    const visibleText = [];
    for (let index = 0; index < await candidates.count(); index += 1) {
      if (await candidates.nth(index).isVisible()) {
        visibleText.push((await candidates.nth(index).innerText()).trim());
      }
    }
    return visibleText.filter(Boolean).join(" | ");
  };

  const waitForReport = async () => {
    await page.locator(".workspace").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForFunction(() => {
      const banner = document.querySelector(".report-load-banner");
      const error = document.querySelector(".report-unavailable.error, .report-load-banner.error");
      return Boolean(error) || Boolean(banner?.textContent?.includes("已加载报表"));
    }, undefined, { timeout: 20000 });
  };

  const readOverflow = () => page.evaluate(() => ({
    viewportWidth: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > innerWidth
  }));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.locator(".report-list").waitFor({ state: "visible", timeout: 20000 });

  const authenticated = await page.getByRole("heading", { name: "政策监测与分析报表" }).count() === 1;
  const desktop = [];
  let reportButtons = page.locator(".report-list > button");
  const reportCount = await reportButtons.count();
  const reportExpectations = [];
  for (let index = 0; index < reportCount; index += 1) {
    const card = reportButtons.nth(index);
    const title = (await card.locator(".report-list-title strong").textContent())?.trim() || `report-${index}`;
    const metricsText = (await card.locator(".report-list-metrics").innerText()).replace(/\s+/g, " ");
    const companyMatch = metricsText.match(/代表公司\s*(\d+)/);
    reportExpectations.push({ title, companyCount: Number(companyMatch?.[1] ?? 0) });
  }
  const expectedTitles = reportExpectations.map((item) => item.title);

  for (let index = 0; index < reportCount; index += 1) {
    reportButtons = page.locator(".report-list > button");
    const title = (await reportButtons.nth(index).locator(".report-list-title strong").textContent())?.trim() || `report-${index}`;
    const errorStart = consoleErrors.length + pageErrors.length + requestFailures.length;
    await reportButtons.nth(index).click();
    await waitForReport();

    const reportId = await page.locator(".workspace").getAttribute("data-report-id");
    const desktopNav = page.locator(".side-nav button");
    if (await desktopNav.count()) {
      await desktopNav.first().click();
      await page.waitForTimeout(80);
    }
    const brief = {
      investmentPanel: await page.locator('.investment-observation-panel[aria-label="投资方向观察"]').count(),
      companyRelations: await page.locator(".investment-company-list article").count(),
      policyNetworkItems: await page.locator(".investment-policy-list article").count(),
      policyNetworkLinks: await page.locator(".investment-policy-list a[href^='http']").count(),
      sourceLinks: await page.getByRole("link", { name: /查看政策原文/ }).count(),
      textLength: (await page.locator(".report-main").innerText()).length
    };

    const modules = [];
    let sideButtons = page.locator(".side-nav button");
    const moduleCount = await sideButtons.count();
    for (let moduleIndex = 0; moduleIndex < moduleCount; moduleIndex += 1) {
      sideButtons = page.locator(".side-nav button");
      const label = (await sideButtons.nth(moduleIndex).innerText()).replace(/\s+/g, " ").trim();
      await sideButtons.nth(moduleIndex).click();
      await page.waitForTimeout(80);
      const mainText = await page.locator(".report-main").innerText();
      const moduleResult = {
        label,
        textLength: mainText.length,
        failure: await readVisibleFailure(),
        overflow: (await readOverflow()).overflow
      };
      if (label.includes("公司")) {
        moduleResult.companyCards = await page.locator(".company-card").count();
        moduleResult.companyTagRegions = await page.locator('[aria-label="公司影响标签"]').count();
        moduleResult.companyNames = (await page.locator(".company-card-title strong").allTextContents()).slice(0, 5);
      }
      if (label.includes("证据")) {
        moduleResult.evidenceItems = await page.locator(".evidence-list article, .evidence-card, .evidence-grid article").count();
      }
      modules.push(moduleResult);
    }

    desktop.push({
      index,
      reportId,
      title,
      failure: await readVisibleFailure(),
      overflow: await readOverflow(),
      brief,
      modules,
      newRuntimeErrors: consoleErrors.length + pageErrors.length + requestFailures.length - errorStart
    });

    await page.getByRole("button", { name: "返回政策列表" }).click();
    await page.locator(".report-list").waitFor({ state: "visible", timeout: 15000 });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = [];
  for (let index = 0; index < reportCount; index += 1) {
    reportButtons = page.locator(".report-list > button");
    const title = (await reportButtons.nth(index).locator(".report-list-title strong").textContent())?.trim() || `report-${index}`;
    const errorStart = consoleErrors.length + pageErrors.length + requestFailures.length;
    await reportButtons.nth(index).click();
    await waitForReport();

    const reportId = await page.locator(".workspace").getAttribute("data-report-id");
    const initialOverflow = await readOverflow();

    await page.getByRole("button", { name: "打开章节罗盘" }).click();
    const nav = page.locator('.mobile-nav-grid[aria-label="报表章节"]');
    await nav.waitFor({ state: "visible", timeout: 5000 });
    let moduleButtons = nav.locator("button");
    const mobileModuleLabels = (await moduleButtons.allTextContents()).map((value) => value.replace(/\s+/g, " ").trim());
    const briefIndex = Math.max(0, mobileModuleLabels.findIndex((value) => value.includes("政策速读")));
    if (mobileModuleLabels.length) {
      await moduleButtons.nth(briefIndex).click();
      await page.waitForTimeout(100);
    }
    const mobilePolicyNetwork = await page.locator(".mobile-investment-policy-network").count();
    const mobilePolicyNetworkLinks = await page.locator(".mobile-investment-policy-network a[href^='http']").count();

    await page.getByRole("button", { name: "打开章节罗盘" }).click();
    await nav.waitFor({ state: "visible", timeout: 5000 });
    moduleButtons = nav.locator("button");
    const companyIndex = mobileModuleLabels.findIndex((value) => value.includes("公司"));
    const targetModuleIndex = companyIndex >= 0 ? companyIndex : Math.max(0, mobileModuleLabels.length - 1);
    if (mobileModuleLabels.length) {
      await moduleButtons.nth(targetModuleIndex).click();
      await page.waitForTimeout(100);
    }

    const afterModuleOverflow = await readOverflow();
    const mobileCompanyCards = await page.locator(".mobile-company-card, .company-card").count();
    const mobileTextLength = (await page.locator(".report-main").innerText()).length;

    mobile.push({
      index,
      reportId,
      title,
      failure: await readVisibleFailure(),
      initialOverflow,
      afterModuleOverflow,
      moduleCount: mobileModuleLabels.length,
      moduleLabels: mobileModuleLabels,
      selectedModule: mobileModuleLabels[targetModuleIndex] || "",
      mobileCompanyCards,
      mobilePolicyNetwork,
      mobilePolicyNetworkLinks,
      textLength: mobileTextLength,
      newRuntimeErrors: consoleErrors.length + pageErrors.length + requestFailures.length - errorStart
    });

    await page.getByRole("button", { name: "打开章节罗盘" }).click();
    await page.getByRole("button", { name: "政策列表" }).click();
    await page.locator(".report-list").waitFor({ state: "visible", timeout: 15000 });
  }

  const summarize = (items) => ({
    total: items.length,
    failures: items.filter((item) => item.failure).map((item) => ({ reportId: item.reportId, title: item.title, failure: item.failure })),
    overflow: items.filter((item) => item.overflow?.overflow || item.initialOverflow?.overflow || item.afterModuleOverflow?.overflow).map((item) => ({ reportId: item.reportId, title: item.title })),
    runtimeErrors: items.filter((item) => item.newRuntimeErrors > 0).map((item) => ({ reportId: item.reportId, title: item.title, count: item.newRuntimeErrors }))
  });

  const desktopSummary = summarize(desktop);
  const mobileSummary = summarize(mobile);

  const desktopChecks = desktop.map((item) => {
    const companyModule = item.modules.find((module) => module.label.includes("公司"));
    return {
      reportId: item.reportId,
      title: item.title,
      expectedCompanyCount: reportExpectations[item.index]?.companyCount ?? 0,
      moduleCount: item.modules.length,
      investmentPanel: item.brief.investmentPanel,
      policyNetworkItems: item.brief.policyNetworkItems,
      policyNetworkLinks: item.brief.policyNetworkLinks,
      companyCards: companyModule?.companyCards ?? 0,
      companyTagRegions: companyModule?.companyTagRegions ?? 0,
      companyNames: companyModule?.companyNames ?? [],
      companyCountMatches: (companyModule?.companyCards ?? 0) === (reportExpectations[item.index]?.companyCount ?? 0),
      companyTagCountMatches: (companyModule?.companyTagRegions ?? 0) === (companyModule?.companyCards ?? 0),
      failure: item.failure,
      overflow: item.overflow.overflow || item.modules.some((module) => module.overflow),
      runtimeErrors: item.newRuntimeErrors
    };
  });
  const mobileChecks = mobile.map((item) => ({
    reportId: item.reportId,
    title: item.title,
    expectedCompanyCount: reportExpectations[item.index]?.companyCount ?? 0,
    moduleCount: item.moduleCount,
    selectedModule: item.selectedModule,
    mobileCompanyCards: item.mobileCompanyCards,
    companyCountMatches: item.mobileCompanyCards === (reportExpectations[item.index]?.companyCount ?? 0),
    mobilePolicyNetwork: item.mobilePolicyNetwork,
    mobilePolicyNetworkLinks: item.mobilePolicyNetworkLinks,
    failure: item.failure,
    overflow: item.initialOverflow.overflow || item.afterModuleOverflow.overflow,
    runtimeErrors: item.newRuntimeErrors
  }));

  const assertionFailures = [];
  if (!authenticated) assertionFailures.push("authenticated session was not loaded");
  if (reportCount !== 20) assertionFailures.push(`expected 20 reports, found ${reportCount}`);
  if (desktopChecks.some((item) => item.moduleCount !== 7)) assertionFailures.push("one or more desktop reports do not expose 7 modules");
  if (mobileChecks.some((item) => item.moduleCount !== 7)) assertionFailures.push("one or more mobile reports do not expose 7 modules");
  if (desktopChecks.some((item) => !item.companyCountMatches || !item.companyTagCountMatches)) assertionFailures.push("desktop company projection does not match authoritative report count or tags");
  if (mobileChecks.some((item) => !item.companyCountMatches)) assertionFailures.push("mobile company projection does not match authoritative report count");
  if (desktop.filter((item) => item.brief.investmentPanel > 0).length !== 17) assertionFailures.push("expected 17 investment observation panels");
  if (desktop.filter((item) => item.brief.policyNetworkItems > 0).length !== 17) assertionFailures.push("expected 17 policy network panels");
  if (desktopSummary.failures.length || mobileSummary.failures.length) assertionFailures.push("visible report failure states were found");
  if (desktopSummary.overflow.length || mobileSummary.overflow.length) assertionFailures.push("horizontal overflow was found");
  if (desktopSummary.runtimeErrors.length || mobileSummary.runtimeErrors.length || consoleErrors.length || pageErrors.length || requestFailures.length) assertionFailures.push("runtime errors or failed requests were found");

  const result = {
    authenticated,
    reportCount,
    expectedTitles,
    fullInvestmentPanels: desktop.filter((item) => item.brief.investmentPanel > 0).length,
    policyNetworkPanels: desktop.filter((item) => item.brief.policyNetworkItems > 0).length,
    desktopSummary,
    mobileSummary,
    consoleErrors: [...new Set(consoleErrors)],
    pageErrors: [...new Set(pageErrors)],
    requestFailures: [...new Set(requestFailures)],
    desktopChecks,
    mobileChecks,
    assertionFailures
  };

  if (assertionFailures.length > 0) {
    throw new Error(`Authenticated production QA failed: ${assertionFailures.join("; ")}\n${JSON.stringify(result)}`);
  }

  return result;
}
