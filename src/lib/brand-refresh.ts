import { injectBrandLogo } from "./brand-injector.ts";
import { pagePlanFor } from "./deck-plan.ts";
import { stripLegacyLogoReservations } from "./brand-logo-layout.ts";
import { getBrandTemplate } from "./brand-templates.ts";
import { getDeckPlan, getReferenceState, saveDeckPlan, saveReferenceState } from "./project-artifacts.ts";
import { listPages, listProjects, updatePage, updateProject } from "./store";

export function refreshBrandTemplateProjects(templateId: string): {
  projects: number;
  pages: number;
} {
  const template = getBrandTemplate(templateId);
  let projects = 0;
  let pages = 0;

  for (const project of listProjects()) {
    if (project.brand_template_id !== templateId) continue;
    updateProject(project.id, { brand_template_json: JSON.stringify(template) });
    const reference = getReferenceState(project.id, project.style_id);
    if (reference.mode === "brand") {
      saveReferenceState(project.id, { ...reference, profile: template.profile });
    }
    projects += 1;
    const projectPages = listPages(project.id);
    const currentPlan = getDeckPlan(project.id);
    const plannedPages = projectPages.map((page) => pagePlanFor(currentPlan, page, template));
    if (currentPlan) {
      saveDeckPlan(project.id, {
        ...currentPlan,
        shared: {
          ...currentPlan.shared,
          canvas: stripLegacyLogoReservations(currentPlan.shared.canvas),
          margins: stripLegacyLogoReservations(currentPlan.shared.margins),
          consistencyRules: currentPlan.shared.consistencyRules
            .map(stripLegacyLogoReservations)
            .filter(Boolean),
        },
        pages: plannedPages,
      });
    }
    const planByCode = new Map(plannedPages.map((page) => [page.pageCode, page]));
    for (const page of projectPages) {
      if (!page.design_svg || page.design_status !== "ready") continue;
      const pagePlan = planByCode.get(page.page_code);
      updatePage(page.id, {
        design_svg: injectBrandLogo(page.design_svg, template, page.page_type, pagePlan?.brandLogo),
      });
      pages += 1;
    }
  }
  return { projects, pages };
}
