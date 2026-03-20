import { defineConfig } from "vitepress";

export default defineConfig({
	title: "nixPI",
	description: "Pi-native AI companion OS on NixOS",
	lang: "en-US",
	cleanUrls: true,
	lastUpdated: true,
	ignoreDeadLinks: true,

	themeConfig: {
		nav: [
			{ text: "Overview", link: "/" },
			{ text: "Getting Started", link: "/getting-started/" },
			{ text: "Architecture", link: "/architecture/" },
			{ text: "Codebase", link: "/codebase/" },
			{ text: "Operations", link: "/operations/" },
			{ text: "Reference", link: "/reference/" },
			{ text: "Contributing", link: "/contributing/" },
		],

		sidebar: {
			"/getting-started/": [
				{
					text: "Getting Started",
					items: [{ text: "Introduction", link: "/getting-started/" }],
				},
			],

			"/architecture/": [
				{
					text: "Architecture",
					items: [
						{ text: "Overview", link: "/architecture/" },
						{ text: "Runtime Flows", link: "/architecture/runtime-flows" },
					],
				},
			],

			"/codebase/": [
				{
					text: "Codebase Guide",
					items: [
						{ text: "Overview", link: "/codebase/" },
						{ text: "Root Files", link: "/codebase/root-files" },
						{ text: "Core Library", link: "/codebase/core-lib" },
						{ text: "Daemon", link: "/codebase/daemon" },
						{ text: "Pi Extensions", link: "/codebase/pi-extensions" },
						{ text: "Persona & Skills", link: "/codebase/pi-persona-skills" },
						{ text: "OS Modules", link: "/codebase/os" },
						{ text: "Scripts & Tools", link: "/codebase/scripts" },
						{ text: "Tests", link: "/codebase/tests" },
					],
				},
			],

			"/operations/": [
				{
					text: "Operations",
					items: [
						{ text: "Quick Deploy", link: "/operations/quick-deploy" },
						{ text: "First Boot Setup", link: "/operations/first-boot-setup" },
						{ text: "Live Testing", link: "/operations/live-testing" },
					],
				},
			],

			"/reference/": [
				{
					text: "Reference",
					items: [
						{ text: "Service Architecture", link: "/reference/service-architecture" },
						{ text: "Daemon Architecture", link: "/reference/daemon-architecture" },
						{ text: "Memory Model", link: "/reference/memory-model" },
						{ text: "Security Model", link: "/reference/security-model" },
						{ text: "Supply Chain", link: "/reference/supply-chain" },
						{ text: "Infrastructure", link: "/reference/infrastructure" },
						{ text: "Fleet Workflow", link: "/reference/fleet-workflow" },
					],
				},
			],

			"/contributing/": [
				{
					text: "Contributing",
					items: [
						{ text: "Documentation Maintenance", link: "/contributing/docs-maintenance" },
					],
				},
			],
		},

		socialLinks: [
			{ icon: "github", link: "https://github.com/alexradunet/nixPI" },
		],

		editLink: {
			pattern: "https://github.com/alexradunet/nixPI/edit/main/docs/:path",
			text: "Edit this page on GitHub",
		},

		footer: {
			message: "Released under the MIT License.",
			copyright: "Copyright © 2024-present nixPI contributors",
		},

		search: {
			provider: "local",
		},
	},
});
