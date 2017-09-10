
## [煜瑛203CS开发板服务器](https://github.com/HeiSir2014/M203CS-Server)

- 此代码主要是对开发板发来的数据进行解析保存到本地，代码中使用了高德API对GPS坐标进行了转换，可以在高德地图和腾讯地图中进行显示。

- 客户端调用可以通过websocket接口连接到此服务器，然后获取开发板的位置以及历史路径。
### Windows
- 直接运行 RunServer.bat 就可以启动服务
### Linux
- 安装 nodejs (https://nodejs.org/en/download/package-manager/)
- 我使用的是Ubuntu 安装nodejs 8.x 执行以下命令
```
    curl -sL https://deb.nodesource.com/setup_8.x | sudo -E bash -
    sudo apt-get install -y nodejs
```
- 安装 nodejs 成功后，运行以下命令安装 node-modules
```
    sh install.sh
```
- 启动服务器
```
    sh runServer.sh
```

### 学习交流
- 作者:HeiSir QQ:369946814

- QQ讨论群：657996991
