.PHONY: build-RunnerFunction clean-RunnerFunction

EXCLUDES = \
	--exclude '.git/' \
	--exclude '.aws-sam/' \
	--exclude '.npm-cache/' \
	--exclude 'infra/' \
	--exclude 'downloads/' \
	--exclude 'lambda-package.zip' \
	--exclude 'lambda.zip' \
	--exclude 'templates/site-base/node_modules/' \
	--exclude 'templates/site-base/dist/'

build-RunnerFunction:
	@echo "Packaging Lambda artifacts into $$ARTIFACTS_DIR"
	@test -n "$$ARTIFACTS_DIR" || (echo "ARTIFACTS_DIR is not set" >&2; exit 1)
	@mkdir -p "$$ARTIFACTS_DIR"
	rsync -a --delete $(EXCLUDES) ./ "$$ARTIFACTS_DIR"/
	@cd "$$ARTIFACTS_DIR" && node ./node_modules/typescript/bin/tsc -p tsconfig.json
	npm prune --omit=dev --prefix "$$ARTIFACTS_DIR"

clean-RunnerFunction:
	@echo "Cleaning $$ARTIFACTS_DIR"
	@test -n "$$ARTIFACTS_DIR" || exit 0
	rm -rf "$$ARTIFACTS_DIR"
