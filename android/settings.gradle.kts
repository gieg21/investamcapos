pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google(); mavenCentral()
        // TODO(Disglobal): repositorio o .aar del SDK de Newland que entregue Disglobal (serial de la terminal).
        // flatDir { dirs("app/libs") }
    }
}
rootProject.name = "InvestaMcaPos"
include(":app")
