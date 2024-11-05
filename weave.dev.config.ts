import { defineConfig } from "@theweave/cli";

export default defineConfig({
  groups: [
    {
      name: "Tennis Club",
      networkSeed: "098rc1m-09384u-crm-29384u-cmkj",
      icon: {
        type: "https",
        url: "https://cdn0.iconfinder.com/data/icons/sports-43/281/sport-sports_21-1024.png",
      },
      creatingAgent: {
        agentIdx: 1,
        agentProfile: {
          nickname: "Gaston",
          avatar: {
            type: "https",
            url: "https://i.pinimg.com/originals/38/b2/03/38b20399fd3a5a890ad8e045615ac5bf.jpg",
          },
        },
      },
      joiningAgents: [
        {
          agentIdx: 2,
          agentProfile: {
            nickname: "Marsupilami",
            avatar: {
              type: "https",
              url:
                "https://1.bp.blogspot.com/-RpUDITUWkpI/TYZSIwI1boI/AAAAAAAAGcQ/dfiskKd9ioM/w1200-h630-p-k-no-nu/marsupilami3.png",
            },
          },
        },
      ],
      applets: [
        {
          name: "SimpleHolochain",
          instanceName: "SimpleHolochain",
          registeringAgent: 1,
          joiningAgents: [2],
        },
        {
          name: "KanDo",
          instanceName: "KanDo",
          registeringAgent: 1,
          joiningAgents: [2],
        },
      ],
    },
  ],
  applets: [
    {
      name: "SimpleHolochain",
      subtitle: "An example Weave Tool built using SimpleHolochain",
      description: "This is an example Weave Tool built using SimpleHolochain.",
      icon: {
        type: "https",
        url: "https://cdn-icons-png.flaticon.com/512/5110/5110487.png",
      },
      source: {
        type: "localhost",
        happPath: "./workdir/generic-dna.happ",
        uiPort: 8888,
      },
    },
    {
      name: "KanDo",
      subtitle: "KanBan board on Holochain",
      description: "KanBan board",
      icon: {
        type: "https",
        url: "https://theweave.social/images/kando_icon.png",
      },
      source: {
        type: "https",
        url: "https://github.com/holochain-apps/kando/releases/download/v0.11.0-rc.0/kando.webhapp",
      },
    },
  ],
});
