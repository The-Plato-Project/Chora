import type { ForgeConfig } from "@electron-forge/shared-types";

const config: ForgeConfig = {
	packagerConfig: {
		asar: true,
		extraResource: ["docs"],
		name: "Chora",
		executableName: "chora"
	},
	makers: [
		{
			name: "@electron-forge/maker-squirrel",
			config: {}
		},
		{
			name: "@electron-forge/maker-zip",
			config: {},
			platforms: ["darwin"]
		},
		{
			name: "@electron-forge/maker-deb",
			config: {}
		},
		{
			name: "@electron-forge/maker-rpm",
			config: {}
		}
	]
};

export default config;
